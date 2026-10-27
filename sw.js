self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Manejo de recepción de archivos compartidos vía Web Share Target (WhatsApp)
  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const pdfFile = formData.get('pdf_file');

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      
      let client = clientList[0];
      if (!client) {
        // Si la app no está abierta, abre una nueva ventana
        client = await self.clients.openWindow('./index.html');
      }

      // Esperar un instante breve para asegurar la comunicación con la ventana activa
      setTimeout(() => {
        if (client && pdfFile) {
          client.postMessage({ file: pdfFile });
        }
      }, 1000);

      return Response.redirect('./index.html', 303);
    })());
  }
});