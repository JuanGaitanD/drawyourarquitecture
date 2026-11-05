rules_version = '2';

// Plantilla: scripts/render-rules.mjs sustituye __OWNER_UID__ y escribe storage.rules.
// La lectura pública consulta Firestore (firestore.get): en producción exige el rol IAM entre productos
// (ver HANDOFF.md · despliegue).
service firebase.storage {
  match /b/{bucket}/o {

    function isOwner() {
      return request.auth != null && request.auth.uid == '__OWNER_UID__';
    }

    function isPublicProject(id) {
      return firestore.get(/databases/(default)/documents/projects/$(id)).data.isPublic == true;
    }

    match /projects/{id}/files/{fileId} {
      allow get: if isOwner() || isPublicProject(id);
      allow list: if isOwner();

      // Solo rasterizadas (nada de SVG) y hasta 4 MiB.
      allow create, update: if isOwner()
        && request.resource.size <= 4 * 1024 * 1024
        && request.resource.contentType.matches('image/(png|jpeg|gif|webp)');

      // Borrar no mira request.resource (no existe en un delete).
      allow delete: if isOwner();
    }
  }
}
