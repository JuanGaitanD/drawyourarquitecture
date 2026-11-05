rules_version = '2';

// Plantilla: scripts/render-rules.mjs sustituye __OWNER_UID__ (de .env, o «owner-test» con --emulator)
// y escribe firestore.rules. No despliegues esta plantilla: despliega el archivo renderizado.
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwner() {
      return request.auth != null && request.auth.uid == '__OWNER_UID__';
    }

    // Quién puede crear proyectos. Hoy solo el dueño; el carril P3 lo amplía con allowedUsers.
    function canCreate() {
      return isOwner();
    }

    function projectDoc(id) {
      return get(/databases/$(database)/documents/projects/$(id)).data;
    }

    // `p` es el contenido de un proyecto (resource.data o projectDoc(id)).
    function isProjectOwner(p) {
      return request.auth != null && p.ownerId == request.auth.uid;
    }
    function memberRole(p) {
      return (request.auth != null && request.auth.uid in p.get('members', {}))
        ? p.members[request.auth.uid] : '';
    }
    function canRead(p) {
      return isProjectOwner(p) || memberRole(p) in ['editor', 'viewer'] || p.isPublic == true;
    }
    function canWrite(p) {
      return isProjectOwner(p) || memberRole(p) == 'editor';
    }
    function isMemberOrOwner(p) {
      return isProjectOwner(p) || memberRole(p) in ['editor', 'viewer'];
    }
    function validMembers(m) {
      return m is map && m.size() <= 20 && m.values().hasOnly(['editor', 'viewer']);
    }

    function validTitle(t) {
      return t is string && t.size() > 0 && t.size() <= 120;
    }

    // Una invitación vale si es del proyecto, trae ese rol y no ha caducado.
    function validInvite(token, pid, role) {
      let inv = get(/databases/$(database)/documents/invites/$(token)).data;
      return inv.projectId == pid && inv.role == role && inv.expiresAt > request.time.toMillis();
    }

    // Unirse con una invitación: la persona se añade sola a `members` y deja en `joins/{uid}` el token que lo
    // justifica (getAfter ve ese documento escrito en el mismo batch).
    function isJoining(id) {
      return request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['members'])
        && request.resource.data.members.diff(resource.data.get('members', {})).affectedKeys().hasOnly([request.auth.uid])
        && request.resource.data.members[request.auth.uid]
          == getAfter(/databases/$(database)/documents/projects/$(id)/joins/$(request.auth.uid)).data.role
        && validMembers(request.resource.data.members);
    }

    match /projects/{id} {
      // Un proyecto público se lee con get; nunca se lista: list es del dueño (`ownerId == uid`) y de quien es
      // miembro (`members.<uid> in [...]`, sin orderBy: no hay índice compuesto posible por uid).
      allow get: if canRead(resource.data);
      allow list: if isProjectOwner(resource.data) || memberRole(resource.data) in ['editor', 'viewer'];

      allow create: if canCreate()
        && request.resource.data.keys().hasOnly(['ownerId', 'type', 'title', 'isPublic', 'createdAt', 'updatedAt'])
        && request.resource.data.keys().hasAll(['ownerId', 'type', 'title', 'isPublic', 'createdAt', 'updatedAt'])
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.type in ['note', 'board']
        && validTitle(request.resource.data.title)
        && request.resource.data.isPublic is bool
        && request.resource.data.createdAt is number
        && request.resource.data.updatedAt is number;

      // Dueño: title, isPublic, members y updatedAt (ownerId y type son inmutables). Editor: solo updatedAt (lo sube
      // cada guardado de contenido). Invitado: solo añadirse a `members` con una invitación válida.
      allow update: if (isProjectOwner(resource.data)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title', 'isPublic', 'updatedAt', 'members'])
          && validTitle(request.resource.data.title)
          && request.resource.data.isPublic is bool
          && request.resource.data.updatedAt is number
          && validMembers(request.resource.data.get('members', {})))
        || (memberRole(resource.data) == 'editor'
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['updatedAt'])
          && request.resource.data.updatedAt is number)
        || isJoining(id);

      allow delete: if isProjectOwner(resource.data);

      // Rastro de quién entró y con qué invitación.
      match /joins/{uid} {
        allow get, list: if isProjectOwner(projectDoc(id));
        allow create, update: if request.auth != null && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['token', 'role'])
          && request.resource.data.keys().hasAll(['token', 'role'])
          && request.resource.data.token is string
          && request.resource.data.role in ['editor', 'viewer']
          && validInvite(request.resource.data.token, id, request.resource.data.role);
        allow delete: if isProjectOwner(projectDoc(id));
      }

      // Presencia: solo dueño y miembros; cada uno escribe su propio documento.
      match /presence/{uid} {
        allow get, list: if isMemberOrOwner(projectDoc(id));
        allow create, update: if request.auth != null && request.auth.uid == uid
          && isMemberOrOwner(projectDoc(id))
          && request.resource.data.keys().hasOnly(['name', 'color', 'x', 'y', 'at'])
          && request.resource.data.keys().hasAll(['name', 'color', 'x', 'y', 'at'])
          && request.resource.data.name is string && request.resource.data.name.size() <= 80
          && request.resource.data.color is string && request.resource.data.color.size() <= 20
          && request.resource.data.x is number && request.resource.data.y is number
          && request.resource.data.at is number;
        allow delete: if request.auth != null && request.auth.uid == uid;
      }

      match /content/main {
        // Hereda la lectura del padre.
        allow get: if canRead(projectDoc(id));

        // Se crea en el mismo batch que el proyecto: getAfter ve el proyecto ya escrito.
        allow create: if canCreate()
          && getAfter(/databases/$(database)/documents/projects/$(id)).data.ownerId == request.auth.uid
          && request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.keys().hasAll(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.data is string
          && request.resource.data.data.size() <= 900000
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == 0
          && request.resource.data.updatedAt is number;

        // Escriben el dueño y los editores. La revisión es monótona: cada guardado sube exactamente una.
        allow update: if canWrite(projectDoc(id))
          && request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.data is string
          && request.resource.data.data.size() <= 900000
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == resource.data.revision + 1
          && request.resource.data.updatedAt is number;

        allow delete: if isProjectOwner(projectDoc(id));
      }

      // Imágenes en trozos (plan · invariante 3). La lectura hereda la del proyecto; escriben dueño y editores.
      // La meta se escribe la última; los trozos no se listan salvo el dueño (el visor lee por id).
      match /files/{fileId} {
        allow get: if canRead(projectDoc(id));
        allow list: if isProjectOwner(projectDoc(id));

        allow create, update: if canWrite(projectDoc(id))
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

        allow delete: if isProjectOwner(projectDoc(id));

        match /chunks/{i} {
          allow get: if canRead(projectDoc(id));
          allow list: if isProjectOwner(projectDoc(id));

          allow create, update: if canWrite(projectDoc(id))
            && i.matches('[0-9]')
            && request.resource.data.keys().hasOnly(['data'])
            && request.resource.data.data is bytes
            && request.resource.data.data.size() <= 900000;

          allow delete: if isProjectOwner(projectDoc(id));
        }
      }
    }

    // Invitaciones: el token (id) es el secreto. Se lee con get; solo se listan las propias. Las crea y borra el
    // dueño del proyecto y caducan a los 7 días como máximo.
    match /invites/{token} {
      allow get: if request.auth != null;
      allow list: if request.auth != null && resource.data.createdBy == request.auth.uid;
      allow create: if request.auth != null
        && token.size() >= 20
        && request.resource.data.keys().hasOnly(['projectId', 'role', 'createdBy', 'expiresAt'])
        && request.resource.data.keys().hasAll(['projectId', 'role', 'createdBy', 'expiresAt'])
        && request.resource.data.projectId is string
        && isProjectOwner(projectDoc(request.resource.data.projectId))
        && request.resource.data.role in ['editor', 'viewer']
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.expiresAt is number
        && request.resource.data.expiresAt > request.time.toMillis()
        && request.resource.data.expiresAt <= request.time.toMillis() + 604800000 + 60000;
      allow delete: if request.auth != null && resource.data.createdBy == request.auth.uid;
    }
  }
}
