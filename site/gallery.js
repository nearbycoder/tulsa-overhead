const viewer = document.querySelector('#viewer');
const image = document.querySelector('#viewer-image');
const caption = document.querySelector('#viewer-caption');

if (typeof viewer.showModal === 'function') {
  for (const shot of document.querySelectorAll('.shot')) {
    shot.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      image.src = shot.href;
      image.alt = shot.querySelector('img').alt;
      caption.textContent = shot.closest('figure').querySelector('figcaption').textContent;
      viewer.showModal();
    });
  }
  document.querySelector('#viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target === viewer) viewer.close();
  });
}
