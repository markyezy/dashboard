/**
 * @module ol/tilegrid/TileGrid
 */
import {DEFAULT_TILE_SIZE} from './common.js';
import {assert} from '../asserts.js';
import TileRange from '../TileRange.js';
import {isSorted, linearFindNearest} from '../array.js';
import {createOrUpdate, getTopLeft} from '../extent.js';
import {clamp} from '../math.js';
import {toSize} from '../size.js';
import {createOrUpdate as tileCoordCreateOrUpdate} from '../tilecoord.js';

/**
 * @classdesc
 * Base class for setting the grid pattern for sources accessing tiled-image
 * servers.
 *
 * @constructor
 * @param {olx.tilegrid.TileGridOptions} options Tile grid options.
 * @struct
 * @api
 */
const TileGrid = function(options) {

  /**
   * @protected
   * @type {number}
   */
  this.minZoom = options.minZoom !== undefined ? options.minZoom : 0;

  /**
   * @private
   * @type {!Array.<number>}
   */
  this.resolutions_ = options.resolutions;
  assert(isSorted(this.resolutions_, function(a, b) {
    return b - a;
  }, true), 17); // `resolutions` must be sorted in descending order


  // check if we've got a consistent zoom factor and origin
  let zoomFactor;
  if (!options.origins) {
    for (let i = 0, ii = this.resolutions_.length - 1; i < ii; ++i) {
      if (!zoomFactor) {
        zoomFactor = this.resolutions_[i] / this.resolutions_[i + 1];
      } else {
        if (this.resolutions_[i] / this.resolutions_[i + 1] !== zoomFactor) {
          zoomFactor = undefined;
          break;
        }
      }
    }
  }


  /**
   * @private
   * @type {number|undefined}
   */
  this.zoomFactor_ = zoomFactor;


  /**
   * @protected
   * @type {number}
   */
  this.maxZoom = this.resolutions_.length - 1;

  /**
   * @private
   * @type {ol.Coordinate}
   */
  this.origin_ = options.origin !== undefined ? options.origin : null;

  /**
   * @private
   * @type {Array.<ol.Coordinate>}
   */
  this.origins_ = null;
  if (options.origins !== undefined) {
    this.origins_ = options.origins;
    assert(this.origins_.length == this.resolutions_.length,
      20); // Number of `origins` and `resolutions` must be equal
  }

  const extent = options.extent;

  if (extent !== undefined &&
      !this.origin_ && !this.origins_) {
    this.origin_ = getTopLeft(extent);
  }

  assert(
    (!this.origin_ && this.origins_) || (this.origin_ && !this.origins_),
    18); // Either `origin` or `origins` must be configured, never both

  /**
   * @private
   * @type {Array.<number|ol.Size>}
   */
  this.tileSizes_ = null;
  if (options.tileSizes !== undefined) {
    this.tileSizes_ = options.tileSizes;
    assert(this.tileSizes_.length == this.resolutions_.length,
      19); // Number of `tileSizes` and `resolutions` must be equal
  }

  /**
   * @private
   * @type {number|ol.Size}
   */
  this.tileSize_ = options.tileSize !== undefined ?
    options.tileSize :
    !this.tileSizes_ ? DEFAULT_TILE_SIZE : null;
  assert(
    (!this.tileSize_ && this.tileSizes_) ||
      (this.tileSize_ && !this.tileSizes_),
    22); // Either `tileSize` or `tileSizes` must be configured, never both

  /**
   * @private
   * @type {ol.Extent}
   */
  this.extent_ = extent !== undefined ? extent : null;


  /**
   * @private
   * @type {Array.<ol.TileRange>}
   */
  this.fullTileRanges_ = null;

  /**
   * @private
   * @type {ol.Size}
   */
  this.tmpSize_ = [0, 0];

  if (options.sizes !== undefined) {
    this.fullTileRanges_ = options.sizes.map(function(size, z) {
      const tileRange = new TileRange(
        Math.min(0, size[0]), Math.max(size[0] - 1, -1),
        Math.min(0, size[1]), Math.max(size[1] - 1, -1));
      return tileRange;
    }, this);
  } else if (extent) {
    this.calculateTileRanges_(extent);
  }

};


/**
 * @private
 * @type {ol.TileCoord}
 */
const tmpTileCoord = [0, 0, 0];


/**
 * Call a function with each tile coordinate for a given extent and zoom level.
 *
 * @param {ol.Extent} extent Extent.
 * @param {number} zoom Integer zoom level.
 * @param {function(ol.TileCoord)} callback Function called with each tile coordinate.
 * @api
 */
TileGrid.prototype.forEachTileCoord = function(extent, zoom, callback) {
  const tileRange = this.getTileRangeForExtentAndZ(extent, zoom);
  for (let i = tileRange.minX, ii = tileRange.maxX; i <= ii; ++i) {
    for (let j = tileRange.minY, jj = tileRange.maxY; j <= jj; ++j) {
      callback([zoom, i, j]);
    }
  }
};


/**
 * @param {ol.TileCoord} tileCoord Tile coordinate.
 * @param {function(this: T, number, ol.TileRange): boolean} callback Callback.
 * @param {T=} opt_this The object to use as `this` in `callback`.
 * @param {ol.TileRange=} opt_tileRange Temporary ol.TileRange object.
 * @param {ol.Extent=} opt_extent Temporary ol.Extent object.
 * @return {boolean} Callback succeeded.
 * @template T
 */
TileGrid.prototype.forEachTileCoordParentTileRange = function(tileCoord, callback, opt_this, opt_tileRange, opt_extent) {
  let tileRange, x, y;
  let tileCoordExtent = null;
  let z = tileCoord[0] - 1;
  if (this.zoomFactor_ === 2) {
    x = tileCoord[1];
    y = tileCoord[2];
  } else {
    tileCoordExtent = this.getTileCoordExtent(tileCoord, opt_extent);
  }
  while (z >= this.minZoom) {
    if (this.zoomFactor_ === 2) {
      x = Math.floor(x / 2);
      y = Math.floor(y / 2);
      tileRange = TileRange.createOrUpdate(x, x, y, y, opt_tileRange);
    } else {
      tileRange = this.getTileRangeForExtentAndZ(tileCoordExtent, z, opt_tileRange);
    }
    if (callback.call(opt_this, z, tileRange)) {
      return true;
    }
    --z;
  }
  return false;
};


/**
 * Get the extent for this tile grid, if it was configured.
 * @return {ol.Extent} Extent.
 */
TileGrid.prototype.getExtent = function() {
  return this.extent_;
};


/**
 * Get the maximum zoom level for the grid.
 * @return {number} Max zoom.
 * @api
 */
TileGrid.prototype.getMaxZoom = function() {
  return this.maxZoom;
};


/**
 * Get the minimum zoom level for the grid.
 * @return {number} Min zoom.
 * @api
 */
TileGrid.prototype.getMinZoom = function() {
  return this.minZoom;
};


/**
 * Get the origin for the grid at the given zoom level.
 * @param {number} z Integer zoom level.
 * @return {ol.Coordinate} Origin.
 * @api
 */
TileGrid.prototype.getOrigin = function(z) {
  if (this.origin_) {
    return this.origin_;
  } else {
    return this.origins_[z];
  }
};


/**
 * Get the resolution for the given zoom level.
 * @param {number} z Integer zoom level.
 * @return {number} Resolution.
 * @api
 */
TileGrid.prototype.getResolution = function(z) {
  return this.resolutions_[z];
};


/**
 * Get the list of resolutions for the tile grid.
 * @return {Array.<number>} Resolutions.
 * @api
 */
TileGrid.prototype.getResolutions = function() {
  return this.resolutions_;
};


/**
 * @param {ol.TileCoord} tileCoord Tile coordinate.
 * @param {ol.TileRange=} opt_tileRange Temporary ol.TileRange object.
 * @param {ol.Extent=} opt_extent Temporary ol.Extent object.
 * @return {ol.TileRange} Tile range.
 */
TileGrid.prototype.getTileCoordChildTileRange = function(tileCoord, opt_tileRange, opt_extent) {
  if (tileCoord[0] < this.maxZoom) {
    if (this.zoomFactor_ === 2) {
      const minX = tileCoord[1] * 2;
      const minY = tileCoord[2] * 2;
      return TileRange.createOrUpdate(minX, minX + 1, minY, minY + 1, opt_tileRange);
    }
    const tileCoordExtent = this.getTileCoordExtent(tileCoord, opt_extent);
    return this.getTileRangeForExtentAndZ(
      tileCoordExtent, tileCoord[0] + 1, opt_tileRange);
  }
  return null;
};


/**
 * Get the extent for a tile range.
 * @param {number} z Integer zoom level.
 * @param {ol.TileRange} tileRange Tile range.
 * @param {ol.Extent=} opt_extent Temporary ol.Extent object.
 * @return {ol.Extent} Extent.
 */
TileGrid.prototype.getTileRangeExtent = function(z, tileRange, opt_extent) {
  const origin = this.getOrigin(z);
  const resolution = this.getResolution(z);
  const tileSize = toSize(this.getTileSize(z), this.tmpSize_);
  const minX = origin[0] + tileRange.minX * tileSize[0] * resolution;
  const maxX = origin[0] + (tileRange.maxX + 1) * tileSize[0] * resolution;
  const minY = origin[1] + tileRange.minY * tileSize[1] * resolution;
  const maxY = origin[1] + (tileRange.maxY + 1) * tileSize[1] * resolution;
  return createOrUpdate(minX, minY, maxX, maxY, opt_extent);
};


/**
 * Get a tile range for the given extent and integer zoom level.
 * @param {ol.Extent} extent Extent.
 * @param {number} z Integer zoom level.
 * @param {ol.TileRange=} opt_tileRange Temporary tile range object.
 * @return {ol.TileRange} Tile range.
 */
TileGrid.prototype.getTileRangeForExtentAndZ = function(extent, z, opt_tileRange) {
  const tileCoord = tmpTileCoord;
  this.getTileCoordForXYAndZ_(extent[0], extent[1], z, false, tileCoord);
  const minX = tileCoord[1];
  const minY = tileCoord[2];
  this.getTileCoordForXYAndZ_(extent[2], extent[3], z, true, tileCoord);
  return TileRange.createOrUpdate(
    minX, tileCoord[1], minY, tileCoord[2], opt_tileRange);
};


/**
 * @param {ol.TileCoord} tileCoord Tile coordinate.
 * @return {ol.Coordinate} Tile center.
 */
TileGrid.prototype.getTileCoordCenter = function(tileCoord) {
  const origin = this.getOrigin(tileCoord[0]);
  const resolution = this.getResolution(tileCoord[0]);
  const tileSize = toSize(this.getTileSize(tileCoord[0]), this.tmpSize_);
  return [
    origin[0] + (tileCoord[1] + 0.5) * tileSize[0] * resolution,
    origin[1] + (tileCoord[2] + 0.5) * tileSize[1] * resolution
  ];
};


/**
 * Get the extent of a tile coordinate.
 *
 * @param {ol.TileCoord} tileCoord Tile coordinate.
 * @param {ol.Extent=} opt_extent Temporary extent object.
 * @return {ol.Extent} Extent.
 * @api
 */
TileGrid.prototype.getTileCoordExtent = function(tileCoord, opt_extent) {
  const origin = this.getOrigin(tileCoord[0]);
  const resolution = this.getResolution(tileCoord[0]);
  const tileSize = toSize(this.getTileSize(tileCoord[0]), this.tmpSize_);
  const minX = origin[0] + tileCoord[1] * tileSize[0] * resolution;
  const minY = origin[1] + tileCoord[2] * tileSize[1] * resolution;
  const maxX = minX + tileSize[0] * resolution;
  const maxY = minY + tileSize[1] * resolution;
  return createOrUpdate(minX, minY, maxX, maxY, opt_extent);
};


/**
 * Get the tile coordinate for the given map coordinate and resolution.  This
 * method considers that coordinates that intersect tile boundaries should be
 * assigned the higher tile coordinate.
 *
 * @param {ol.Coordinate} coordinate Coordinate.
 * @param {number} resolution Resolution.
 * @param {ol.TileCoord=} opt_tileCoord Destination ol.TileCoord object.
 * @return {ol.TileCoord} Tile coordinate.
 * @api
 */
TileGrid.prototype.getTileCoordForCoordAndResolution = function(coordinate, resolution, opt_tileCoord) {
  return this.getTileCoordForXYAndResolution_(
    coordinate[0], coordinate[1], resolution, false, opt_tileCoord);
};


/**
 * Note that this method should not be called for resolutions that correspond
 * to an integer zoom level.  Instead call the `getTileCoordForXYAndZ_` method.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {number} resolution Resolution (for a non-integer zoom level).
 * @param {boolean} reverseIntersectionPolicy Instead of letting edge
 *     intersections go to the higher tile coordinate, let edge intersections
 *     go to the lower tile coordinate.
 * @param {ol.TileCoord=} opt_tileCoord Temporary ol.TileCoord object.
 * @return {ol.TileCoord} Tile coordinate.
 * @private
 */
TileGrid.prototype.getTileCoordForXYAndResolution_ = function(
  x, y, resolution, reverseIntersectionPolicy, opt_tileCoord) {
  const z = this.getZForResolution(resolution);
  const scale = resolution / this.getResolution(z);
  const origin = this.getOrigin(z);
  const tileSize = toSize(this.getTileSize(z), this.tmpSize_);

  const adjustX = reverseIntersectionPolicy ? 0.5 : 0;
  const adjustY = reverseIntersectionPolicy ? 0 : 0.5;
  const xFromOrigin = Math.floor((x - origin[0]) / resolution + adjustX);
  const yFromOrigin = Math.floor((y - origin[1]) / resolution + adjustY);
  let tileCoordX = scale * xFromOrigin / tileSize[0];
  let tileCoordY = scale * yFromOrigin / tileSize[1];

  if (reverseIntersectionPolicy) {
    tileCoordX = Math.ceil(tileCoordX) - 1;
    tileCoordY = Math.ceil(tileCoordY) - 1;
  } else {
    tileCoordX = Math.floor(tileCoordX);
    tileCoordY = Math.floor(tileCoordY);
  }

  return tileCoordCreateOrUpdate(z, tileCoordX, tileCoordY, opt_tileCoord);
};


/**
 * Although there is repetition between this method and `getTileCoordForXYAndResolution_`,
 * they should have separate implementations.  This method is for integer zoom
 * levels.  The other method should only be called for resolutions corresponding
 * to non-integer zoom levels.
 * @param {number} x Map x coordinate.
 * @param {number} y Map y coordinate.
 * @param {number} z Integer zoom level.
 * @param {boolean} reverseIntersectionPolicy Instead of letting edge
 *     intersections go to the higher tile coordinate, let edge intersections
 *     go to the lower tile coordinate.
 * @param {ol.TileCoord=} opt_tileCoord Temporary ol.TileCoord object.
 * @return {ol.TileCoord} Tile coordinate.
 * @private
 */
TileGrid.prototype.getTileCoordForXYAndZ_ = function(x, y, z, reverseIntersectionPolicy, opt_tileCoord) {
  const origin = this.getOrigin(z);
  const resolution = this.getResolution(z);
  const tileSize = toSize(this.getTileSize(z), this.tmpSize_);

  const adjustX = reverseIntersectionPolicy ? 0.5 : 0;
  const adjustY = reverseIntersectionPolicy ? 0 : 0.5;
  const xFromOrigin = Math.floor((x - origin[0]) / resolution + adjustX);
  const yFromOrigin = Math.floor((y - origin[1]) / resolution + adjustY);
  let tileCoordX = xFromOrigin / tileSize[0];
  let tileCoordY = yFromOrigin / tileSize[1];

  if (reverseIntersectionPolicy) {
    tileCoordX = Math.ceil(tileCoordX) - 1;
    tileCoordY = Math.ceil(tileCoordY) - 1;
  } else {
    tileCoordX = Math.floor(tileCoordX);
    tileCoordY = Math.floor(tileCoordY);
  }

  return tileCoordCreateOrUpdate(z, tileCoordX, tileCoordY, opt_tileCoord);
};


/**
 * Get a tile coordinate given a map coordinate and zoom level.
 * @param {ol.Coordinate} coordinate Coordinate.
 * @param {number} z Zoom level.
 * @param {ol.TileCoord=} opt_tileCoord Destination ol.TileCoord object.
 * @return {ol.TileCoord} Tile coordinate.
 * @api
 */
TileGrid.prototype.getTileCoordForCoordAndZ = function(coordinate, z, opt_tileCoord) {
  return this.getTileCoordForXYAndZ_(
    coordinate[0], coordinate[1], z, false, opt_tileCoord);
};


/**
 * @param {ol.TileCoord} tileCoord Tile coordinate.
 * @return {number} Tile resolution.
 */
TileGrid.prototype.getTileCoordResolution = function(tileCoord) {
  return this.resolutions_[tileCoord[0]];
};


/**
 * Get the tile size for a zoom level. The type of the return value matches the
 * `tileSize` or `tileSizes` that the tile grid was configured with. To always
 * get an `ol.Size`, run the result through `ol.size.toSize()`.
 * @param {number} z Z.
 * @return {number|ol.Size} Tile size.
 * @api
 */
TileGrid.prototype.getTileSize = function(z) {
  if (this.tileSize_) {
    return this.tileSize_;
  } else {
    return this.tileSizes_[z];
  }
};


/**
 * @param {number} z Zoom level.
 * @return {ol.TileRange} Extent tile range for the specified zoom level.
 */
TileGrid.prototype.getFullTileRange = function(z) {
  if (!this.fullTileRanges_) {
    return null;
  } else {
    return this.fullTileRanges_[z];
  }
};


/**
 * @param {number} resolution Resolution.
 * @param {number=} opt_direction If 0, the nearest resolution will be used.
 *     If 1, the nearest lower resolution will be used. If -1, the nearest
 *     higher resolution will be used. Default is 0.
 * @return {number} Z.
 * @api
 */
TileGrid.prototype.getZForResolution = function(resolution, opt_direction) {
  const z = linearFindNearest(this.resolutions_, resolution, opt_direction || 0);
  return clamp(z, this.minZoom, this.maxZoom);
};


/**
 * @param {!ol.Extent} extent Extent for this tile grid.
 * @private
 */
TileGrid.prototype.calculateTileRanges_ = function(extent) {
  const length = this.resolutions_.length;
  const fullTileRanges = new Array(length);
  for (let z = this.minZoom; z < length; ++z) {
    fullTileRanges[z] = this.getTileRangeForExtentAndZ(extent, z);
  }
  this.fullTileRanges_ = fullTileRanges;
};
export default TileGrid;
