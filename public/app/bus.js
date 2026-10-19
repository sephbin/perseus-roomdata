// Lets the data layer ask for a redraw without importing the view. Without it
// data.js and view.js would import each other, which is where module cycles and
// half-initialised imports come from.
let render = () => {};
export const onRender = fn => { render = fn; };
export const rerender = keepUI => render(keepUI);
