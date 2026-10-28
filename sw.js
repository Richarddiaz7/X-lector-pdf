const CACHE_NAME = 'pdf-reader-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];

// Instalación: cachear recursos
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('Algunos recursos no se cachearon (posible falta de red):', err);
      });
    })
  );
});

// Activación: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => clients.claim())
  );
});

// Fetch: cache-first para recursos, network-first para navegación
self.addEventListener('fetch', (event) => {
  // Manejo especial del POST de WhatsApp (share_target)
  if (event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // Para el resto: cache-first con fallback a red
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cachear recursos nuevos que se soliciten
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Si falla la red y es navegación, devolver index.html cacheado
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Manejo del archivo compartido desde WhatsApp
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const pdfFile = formData.get('pdf_file');

    if (!pdfFile) {
      return Response.redirect('./index.html?error=nofile', 303);
    }

    // Guardar el archivo en IndexedDB temporalmente
    const db = await openDB();
    await saveFileToDB(db, pdfFile);

    // Avisar a todas las ventanas abiertas
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      client.postMessage({ type: 'SHARE_PDF', hasFile: true });
    }

    // Si no hay ventana, abrir una
    if (clientList.length === 0) {
      await self.clients.openWindow('./index.html?shared=1');
    }

    return Response.redirect('./index.html?shared=1', 303);
  } catch (err) {
    console.error('Error en share target:', err);
    return Response.redirect('./index.html?error=sharefail', 303);
  }
}

// Utilidades IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PDFReaderDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sharedFiles')) {
        db.createObjectStore('sharedFiles', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveFileToDB(db, file) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sharedFiles', 'readwrite');
    const store = tx.objectStore('sharedFiles');
    const record = {
      id: 'shared_pdf_' + Date.now(),
      name: file.name,
      type: file.type,
      blob: file,
      timestamp: Date.now()
    };
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}
