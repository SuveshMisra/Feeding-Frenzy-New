import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './ui/styles.css';

const container = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

function fail(message: string): void {
  document.body.classList.add('ready');
  const el = document.createElement('div');
  el.className = 'fatal';
  el.innerHTML = `<h1>Fin Frenzy</h1><p>${message}</p>`;
  document.body.appendChild(el);
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  fail('This game needs WebGL 2. Try a recent version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is on.');
} else if (params.has('gallery')) {
  void Promise.all([import('./engine/Renderer'), import('./debug/Gallery')]).then(([{ Renderer }, { startGallery }]) => {
    document.body.classList.add('ready');
    startGallery(new Renderer(container));
  });
} else {
  import('./app/App')
    .then(({ App }) => new App(container).start())
    .catch((err: unknown) => {
      console.error(err);
      fail('Something went wrong while starting the game. Please reload the page.');
    });
}
