// Lets one module tell another something happened without importing it.
// Without this, data.js and view.js would import each other, which is where
// module cycles and half-initialised imports come from.
//
// It stays a noticeboard, not a second way to run the app: a publisher never
// learns who listened, and a listener never answers back. Two topics so far:
//   'selection'  the cell range changed       (grid -> presence)
//   'painted'    the sheet was rebuilt        (grid -> presence)
// Anything drawn on top of the grid has to hear 'painted', because a rebuild
// throws its classes away with the cells they were on.

let render = () => {};
export const onRender = fn => { render = fn; };
export const rerender = keepUI => render(keepUI);

const subs = new Map();
export const on = (topic, fn) => {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
};
export const emit = (topic, ...args) => {
  // A listener that throws must not stop the others, or one bad overlay would
  // take the sheet down with it.
  subs.get(topic)?.forEach(fn => { try { fn(...args); } catch (e) { console.error(topic, e); } });
};
