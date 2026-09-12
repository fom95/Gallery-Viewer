/*
 * 00-state-and-config.js
 *
 * Core global state: current album/image selection, tag filters, and the
 * responsive gallery's column-count / thumbnail-size settings.
 */

const albums = [];

let currentAlbum = null;

let isQueryAlbum = false;

let currentImageIndex = 0;

let modalLoadID = 0;

let activeImageLoaders = [];

let loadingTimer = null;

const selectedTags = new Set();

const excludedTags = new Set();

let filterMode = "any";


const galleryGap = 1;

const minColumns = 2;

const maxColumns = 5;

const minThumbWidth = 180;

const homeMinColumns = 2;

const homeMaxColumns = 5;

const homeMinThumbWidth = 180;

const homeHeightMultiplier = 1.12;

let currentTemporaryAlbumID = null;
