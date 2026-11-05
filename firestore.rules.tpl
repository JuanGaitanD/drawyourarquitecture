rules_version = '2';

// Plantilla: scripts/render-rules.mjs sustituye __OWNER_UID__ (de .env, o «owner-test» con --emulator)
// y escribe firestore.rules. No despliegues esta plantilla: despliega el archivo renderizado.
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwner() {
      return request.auth != null && request.auth.uid == '__OWNER_UID__';
    }

    function projectDoc(id) {
      return get(/databases/$(database)/documents/projects/$(id)).data;
    }

    function validTitle(t) {
      return t is string && t.size() > 0 && t.size() <= 120;
    }

    match /projects/{id} {
      // Un proyecto público se lee con get; nunca se lista: list es solo del dueño y de lo suyo.
      allow get: if (isOwner() && resource.data.ownerId == request.auth.uid) || resource.data.isPublic == true;
      allow list: if isOwner() && resource.data.ownerId == request.auth.uid;

      allow create: if isOwner()
        && request.resource.data.keys().hasOnly(['ownerId', 'type', 'title', 'isPublic', 'createdAt', 'updatedAt'])
        && request.resource.data.keys().hasAll(['ownerId', 'type', 'title', 'isPublic', 'createdAt', 'updatedAt'])
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.type in ['note', 'board']
        && validTitle(request.resource.data.title)
        && request.resource.data.isPublic is bool
        && request.resource.data.createdAt is number
        && request.resource.data.updatedAt is number;

      // Solo cambian title, isPublic y updatedAt; ownerId y type son inmutables.
      allow update: if isOwner()
        && resource.data.ownerId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title', 'isPublic', 'updatedAt'])
        && validTitle(request.resource.data.title)
        && request.resource.data.isPublic is bool
        && request.resource.data.updatedAt is number;

      allow delete: if isOwner() && resource.data.ownerId == request.auth.uid;

      match /content/main {
        // Hereda la lectura del padre.
        allow get: if (isOwner() && projectDoc(id).ownerId == request.auth.uid) || projectDoc(id).isPublic == true;

        // Se crea en el mismo batch que el proyecto: getAfter ve el proyecto ya escrito.
        allow create: if isOwner()
          && getAfter(/databases/$(database)/documents/projects/$(id)).data.ownerId == request.auth.uid
          && request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.keys().hasAll(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.data is string
          && request.resource.data.data.size() <= 900000
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == 0
          && request.resource.data.updatedAt is number;

        // La revisión es monótona: cada guardado sube exactamente una.
        allow update: if isOwner()
          && projectDoc(id).ownerId == request.auth.uid
          && request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.data is string
          && request.resource.data.data.size() <= 900000
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == resource.data.revision + 1
          && request.resource.data.updatedAt is number;

        allow delete: if isOwner() && projectDoc(id).ownerId == request.auth.uid;
      }

      // Imágenes en trozos (plan · invariante 3). La lectura hereda la del proyecto; la escritura es del dueño.
      // La meta se escribe la última; los trozos no se listan salvo el dueño (el visor lee por id).
      match /files/{fileId} {
        allow get: if (isOwner() && projectDoc(id).ownerId == request.auth.uid) || projectDoc(id).isPublic == true;
        allow list: if isOwner() && projectDoc(id).ownerId == request.auth.uid;

        allow create, update: if isOwner()
          && projectDoc(id).ownerId == request.auth.uid
          && request.resource.data.keys().hasOnly(['mimeType', 'size', 'chunks', 'createdAt'])
          && request.resource.data.keys().hasAll(['mimeType', 'size', 'chunks', 'createdAt'])
          && request.resource.data.mimeType is string
          && request.resource.data.mimeType in ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
          && request.resource.data.size is int
          && request.resource.data.size > 0
          && request.resource.data.size <= 4194304
          && request.resource.data.chunks is int
          && request.resource.data.chunks >= 1
          && request.resource.data.chunks <= 5
          && request.resource.data.createdAt is number;

        allow delete: if isOwner() && projectDoc(id).ownerId == request.auth.uid;

        match /chunks/{i} {
          allow get: if (isOwner() && projectDoc(id).ownerId == request.auth.uid) || projectDoc(id).isPublic == true;
          allow list: if isOwner() && projectDoc(id).ownerId == request.auth.uid;

          allow create, update: if isOwner()
            && projectDoc(id).ownerId == request.auth.uid
            && i.matches('[0-9]')
            && request.resource.data.keys().hasOnly(['data'])
            && request.resource.data.data is bytes
            && request.resource.data.data.size() <= 900000;

          allow delete: if isOwner() && projectDoc(id).ownerId == request.auth.uid;
        }
      }
    }
  }
}
