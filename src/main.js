if (new URLSearchParams(location.search).has('lab')) {
  import('./lab.js');
} else {
  import('./product.js');
}
