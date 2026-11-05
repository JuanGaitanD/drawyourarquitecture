rules_version = '2';

// Plantilla: scripts/render-rules.mjs sustituye __OWNER_UID__ (de .env, o «owner-test» con --emulator)
// y escribe firestore.rules. No despliegues esta plantilla: despliega el archivo renderizado.
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwner() {
      return request.auth != null && request.auth.uid == '__OWNER_UID__';
    }

    // Quién puede crear proyectos: el dueño o quien él haya añadido por correo en allowedEmails/{email}
    // (id = correo en minúsculas). Solo cuenta un correo verificado por el proveedor de acceso.
    function canCreate() {
      return isOwner()
        || (request.auth != null
          && request.auth.token.email_verified == true
          && exists(/databases/$(database)/documents/allowedEmails/$(request.auth.token.email.lower())));
    }

    function projectDoc(id) {
      return get(/databases/$(database)/documents/projects/$(id)).data;
    }

    // `p` es el contenido de un proyecto (resource.data o projectDoc(id)).
    function isProjectOwner(p) {
      return request.auth != null && p.ownerId == request.auth.uid;
    }
    function memberRole(p) {
      return request.auth == null ? '' : p.get('members', {}).get(request.auth.uid, '');
    }
    function canRead(p) {
      return isProjectOwner(p) || memberRole(p) in ['editor', 'viewer'] || p.isPublic == true;
    }
    function canWrite(p) {
      return isProjectOwner(p) || memberRole(p) == 'editor';
    }
    function validMembers(m) {
      return m is map && m.size() <= 20 && m.values().hasOnly(['editor', 'viewer']);
    }

    // `aclRev` versiona el espejo de acceso de Realtime Database (D33): solo el dueño lo toca y sube exactamente 1 en
    // cada cambio de `members` (y no se mueve si `members` no cambia). Así una publicación atrasada se reconoce y se
    // rechaza. No se usa `updatedAt` porque cualquier editor lo escribe con su reloj.
    function aclRevOk(before, after) {
      return after.get('aclRev', 0) is int
        && (after.get('members', {}) == before.get('members', {})
          ? after.get('aclRev', 0) == before.get('aclRev', 0)
          : after.get('aclRev', 0) == before.get('aclRev', 0) + 1);
    }

    function validTitle(t) {
      return t is string && t.size() > 0 && t.size() <= 120;
    }

    // Una invitación vale si es de este proyecto y no ha caducado (`expiresAt` en ms, comparado con la hora del
    // servidor).
    function validInvite(token, pid) {
      let inv = get(/databases/$(database)/documents/invites/$(token)).data;
      return inv.projectId == pid && inv.expiresAt > request.time.toMillis();
    }

    // Excepción explícita a «los metadatos son del dueño»: unirse con una invitación. El token no viaja en la
    // escritura de `members`, así que el mismo batch crea `joins/{uid} = { token, name }` y la regla lo lee con
    // getAfter; luego get() del invite valida proyecto, caducidad y rol. Solo puede cambiar `members.<uid>`.
    function isJoining(id) {
      return request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['members'])
        && request.resource.data.members.diff(resource.data.get('members', {})).affectedKeys().hasOnly([request.auth.uid])
        && validInvite(getAfter(/databases/$(database)/documents/projects/$(id)/joins/$(request.auth.uid)).data.token, id)
        && request.resource.data.members[request.auth.uid]
          == get(/databases/$(database)/documents/invites/$(getAfter(/databases/$(database)/documents/projects/$(id)/joins/$(request.auth.uid)).data.token)).data.role
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
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title', 'isPublic', 'updatedAt', 'members', 'aclRev'])
          && aclRevOk(resource.data, request.resource.data)
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
          && request.resource.data.keys().hasOnly(['token', 'name'])
          && request.resource.data.keys().hasAll(['token', 'name'])
          && request.resource.data.token is string
          && request.resource.data.name is string && request.resource.data.name.size() <= 80
          && validInvite(request.resource.data.token, id);
        allow delete: if isProjectOwner(projectDoc(id));
      }

      match /content/main {
        // Hereda la lectura del padre.
        allow get: if canRead(projectDoc(id));

        // Se crea en el mismo batch que el proyecto: getAfter ve el proyecto ya escrito. Siempre con `data` (el
        // contenido inicial es pequeño); el troceado solo aparece al guardar.
        allow create: if canCreate()
          && getAfter(/databases/$(database)/documents/projects/$(id)).data.ownerId == request.auth.uid
          && request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.keys().hasAll(['data', 'schemaVersion', 'revision', 'updatedAt'])
          && request.resource.data.data is string
          && request.resource.data.data.size() <= 900000
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == 0
          && request.resource.data.updatedAt is number;

        // Escriben el dueño y los editores. La revisión es monótona: cada guardado sube exactamente una. El
        // contenido cabe en `data` (≤ 900 000) o va troceado: sin `data` y con `chunks` entero de 2 a 12
        // (8 MiB / 900 000 B); los trozos se escriben en la misma transacción.
        allow update: if canWrite(projectDoc(id))
          && request.resource.data.schemaVersion == 1
          && request.resource.data.revision == resource.data.revision + 1
          && request.resource.data.updatedAt is number
          && ((request.resource.data.keys().hasOnly(['data', 'schemaVersion', 'revision', 'updatedAt'])
              && request.resource.data.data is string
              && request.resource.data.data.size() <= 900000)
            || (request.resource.data.keys().hasOnly(['schemaVersion', 'revision', 'updatedAt', 'chunks'])
              && request.resource.data.chunks is int
              && request.resource.data.chunks >= 2
              && request.resource.data.chunks <= 12));

        allow delete: if isProjectOwner(projectDoc(id));

        // Trozos del contenido: la lectura es la del contenido; escriben el dueño y los editores; el que guarda
        // un contenido más corto borra los sobrantes; el dueño los lista (para borrar el proyecto).
        match /chunks/{i} {
          allow get: if canRead(projectDoc(id));
          allow list: if isProjectOwner(projectDoc(id));
          allow create, update: if canWrite(projectDoc(id))
            && i.matches('[0-9]|1[01]')
            && request.resource.data.keys().hasOnly(['data'])
            && request.resource.data.data is string
            && request.resource.data.data.size() <= 900000;
          allow delete: if canWrite(projectDoc(id));
        }
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

    // Lista de permitidos por correo: solo el dueño la escribe y la lista; cada persona (con correo verificado)
    // puede leer su propia entrada. El id es el correo en minúsculas.
    match /allowedEmails/{email} {
      allow get: if request.auth != null
        && (isOwner()
          || (request.auth.token.email_verified == true && request.auth.token.email.lower() == email));
      allow list: if isOwner();
      allow create, update: if isOwner()
        && email == email.lower()
        && email.size() <= 254
        && email.matches('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        && request.resource.data.keys().hasOnly(['email', 'addedAt'])
        && request.resource.data.keys().hasAll(['email', 'addedAt'])
        && request.resource.data.email == email
        && request.resource.data.addedAt is number;
      allow delete: if isOwner();
    }

    // Tokens del servidor MCP (fase 3): el id es el sha256 (hex) del token; el valor nunca se guarda.
    // El cliente crea y revoca los suyos; `lastUsedAt` y la búsqueda por hash los hace el servidor (Admin).
    match /mcpTokens/{hash} {
      allow get, list: if request.auth != null && resource.data.uid == request.auth.uid;
      allow create: if request.auth != null
        && hash.matches('[0-9a-f]{64}')
        && request.resource.data.keys().hasOnly(['uid', 'label', 'createdAt', 'revoked'])
        && request.resource.data.keys().hasAll(['uid', 'label', 'createdAt', 'revoked'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.label is string
        && request.resource.data.label.size() > 0
        && request.resource.data.label.size() <= 60
        && request.resource.data.createdAt is number
        && request.resource.data.revoked == false;
      // Única actualización del cliente: revoked de false a true (no se reactiva, no se borra);
      // `lastUsedAt` lo escribe solo el servidor (Admin), como mucho una vez por hora.
      allow update: if request.auth != null
        && resource.data.uid == request.auth.uid
        && resource.data.revoked == false
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revoked'])
        && request.resource.data.revoked == true;
    }

    // Límite de tasa del servidor MCP: ventana fija de 1 min por token (id = sha256 del token). Lo escribe el
    // propio usuario autenticado (el servidor opera como él): `window` = minuto desde el epoch. Solo se puede
    // empezar con count 1, sumar de uno en uno dentro de la ventana (máx. 60) o abrir una ventana posterior.
    function ownsToken(hash) {
      return request.auth != null
        && get(/databases/$(database)/documents/mcpTokens/$(hash)).data.uid == request.auth.uid;
    }
    match /rateLimits/{hash} {
      allow get: if ownsToken(hash);
      allow create: if ownsToken(hash)
        && request.resource.data.keys().hasOnly(['uid', 'window', 'count'])
        && request.resource.data.keys().hasAll(['uid', 'window', 'count'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.window is int
        && request.resource.data.count == 1;
      allow update: if ownsToken(hash)
        && request.resource.data.keys().hasOnly(['uid', 'window', 'count'])
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.window is int
        && ((request.resource.data.window == resource.data.window
              && request.resource.data.count == resource.data.count + 1
              && request.resource.data.count <= 60)
          || (request.resource.data.window > resource.data.window
              && request.resource.data.count == 1));
    }

    // Auditoría del servidor MCP: una entrada por llamada a una herramienta, escrita por el usuario autenticado
    // (el servidor opera como él). Solo se crea (no se edita ni se borra) y cada quien lee solo las suyas.
    // `expireAt` es un Timestamp: activa la política TTL de Firestore sobre ese campo (docs/mcp.md).
    match /mcpAudit/{id} {
      allow get, list: if request.auth != null && resource.data.uid == request.auth.uid;
      allow create: if ownsToken(request.resource.data.get('tokenHash', ''))
        && request.resource.data.keys().hasOnly(['uid', 'tokenHash', 'tool', 'projectId', 'ok', 'at', 'expireAt'])
        && request.resource.data.keys().hasAll(['uid', 'tokenHash', 'tool', 'ok', 'at', 'expireAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.tokenHash is string
        && request.resource.data.tool in ['list_projects', 'read_note', 'read_board', 'create_note', 'create_board', 'update_board']
        && (!('projectId' in request.resource.data) || (request.resource.data.projectId is string && request.resource.data.projectId.size() <= 128))
        && request.resource.data.ok is bool
        && request.resource.data.at is number
        && request.resource.data.expireAt is timestamp;
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
