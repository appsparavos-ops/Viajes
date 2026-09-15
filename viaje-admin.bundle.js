/* Bitácora Fase 3 — bundle global, file:// compatible, offline+gratuito — 1 fuente → 3 plataformas */

        /* ============================================================
           Bitácora de Viaje — Admin (con respaldo OFFLINE robusto y Multi-Usuario)
           ------------------------------------------------------------
           Soporte multi-usuario con Firebase Auth (Email/Contraseña y Google).
           Cada usuario cuenta con un nombre de usuario único que actúa como
           raíz en Firebase Realtime Database: /{username}/...
           ============================================================ */

        const FIREBASE_AVAILABLE = typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined';

        let db = null;
        let auth = null;
        let isFirebaseConnected = false;
        let authUser = null;
        // Defensa: nunca tratar el string "null" ni vacío como un usuario real
        let currentUsername = (function () {
            try {
                const v = (localStorage.getItem('travelapp_active_user') || '').trim();
                return (v && v !== 'null') ? v : null;
            } catch (e) { return null; }
        })();

        /* ---- Modo borrador local (sin cuenta) ----
           Permite usar la app en un dispositivo que nunca inicio sesion y sin
           internet (p. ej. se instala la app durante el viaje). Todo se guarda
           SOLO en este dispositivo; al iniciar sesion por primera vez se ofrece
           importar esos datos a la cuenta. */
        const DRAFT_USER = '_borrador_local';
        const DRAFT_FLAG_KEY = 'travelapp_modo_borrador';
        let modoBorrador = false;

        function getUserRoot() {
            return currentUsername || 'usuario_anonimo';
        }

        /* ---------------- Manejo de Caracteres Especiales e ID de Firebase ---------------- */
        /**
         * Normaliza y sanitiza cualquier cadena para que sea un ID válido y seguro en Firebase RTDB.
         * En Firebase Realtime Database, los keys NO pueden contener: . $ # [ ] / ni caracteres ASCII de control (0-31, 127).
         * Esta función:
         * 1. Convierte a minúsculas y elimina espacios iniciales/finales.
         * 2. Descompone y elimina acentos y diacríticos (ej: á->a, é->e, ó->o, ü->u).
         * 3. Reemplaza la 'ñ' por 'n'.
         * 4. Convierte espacios intermedios y puntos en guiones bajos (_).
         * 5. Elimina de forma estricta cualquier símbolo prohibido (. $ # [ ] / y signos especiales).
         * 6. Limita el tamaño a 25 caracteres.
         */
        function sanitizeUsername(input) {
            if (!input) return '';
            return input
                .toLowerCase()
                .trim()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "") // quita tildes
                .replace(/ñ/g, 'n')
                .replace(/[\s.]+/g, '_') // convierte espacios y puntos a _
                .replace(/[^a-z0-9_-]/g, '') // filtra todo lo que no sea a-z, 0-9, _ o -
                .slice(0, 25);
        }

        const RESERVED_USERNAMES = new Set(['usernames', 'users', 'viajes_index', 'viajes_data', 'admin', 'api', 'auth', 'null', 'undefined', 'root', 'config', '_borrador_local', 'borrador', 'borrador_local', 'usuario_anonimo']);

        function validateUsernameFormat(username) {
            if (!username || username.length < 3) {
                return 'El nombre de usuario debe tener al menos 3 caracteres.';
            }
            if (username.length > 25) {
                return 'El nombre de usuario no puede superar los 25 caracteres.';
            }
            if (/[.$#[\]/]/.test(username)) {
                return 'El nombre no puede contener caracteres no permitidos en Firebase (. $ # [ ] /).';
            }
            if (!/^[a-z0-9_-]+$/.test(username)) {
                return 'Solo se permiten letras minúsculas (a-z), números (0-9), guiones (-) y guiones bajos (_).';
            }
            if (RESERVED_USERNAMES.has(username.toLowerCase())) {
                return 'Este nombre de usuario está reservado para el sistema.';
            }
            return null;
        }

        function onUsernameInput(val) {
            const sanitized = sanitizeUsername(val);
            const previewEl = document.getElementById('username-preview');
            const noticeEl = document.getElementById('username-sanitized-notice');
            const errorEl = document.getElementById('username-error-msg');
            if (errorEl) errorEl.classList.add('hidden');

            if (!val) {
                if (previewEl) previewEl.classList.add('hidden');
                if (noticeEl) noticeEl.classList.add('hidden');
                return;
            }

            if (previewEl) {
                previewEl.classList.remove('hidden');
                previewEl.textContent = `ID en Firebase: @${sanitized || '...'}`;
            }

            if (noticeEl) {
                if (val.trim().toLowerCase() !== sanitized) {
                    noticeEl.classList.remove('hidden');
                } else {
                    noticeEl.classList.add('hidden');
                }
            }
        }

        /* ---------------- Control de Interfaz de Autenticación ---------------- */
        let authCurrentTab = 'login';

        function setAuthTab(tab) {
            authCurrentTab = tab;
            clearAuthError();
            const tabLogin = document.getElementById('auth-tab-login');
            const tabReg = document.getElementById('auth-tab-register');
            const confirmGroup = document.getElementById('auth-confirm-group');
            const btnText = document.getElementById('auth-btn-text');

            if (tab === 'login') {
                if (tabLogin) tabLogin.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-amber-600 text-amber-700';
                if (tabReg) tabReg.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700';
                if (confirmGroup) confirmGroup.classList.add('hidden');
                if (btnText) btnText.textContent = 'Iniciar Sesión';
            } else {
                if (tabReg) tabReg.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-amber-600 text-amber-700';
                if (tabLogin) tabLogin.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700';
                if (confirmGroup) confirmGroup.classList.remove('hidden');
                if (btnText) btnText.textContent = 'Registrarse';
            }
        }

        function showAuthModal(view = 'credentials') {
            // Si llegamos hasta acá es porque la decisión de sesión ya se tomó:
            // ocultamos la pantalla de carga en el mismo instante en que se muestra
            // el modal (sin parpadeos intermedios).
            hideBootScreen();
            actualizarAvisoOffline();
            const overlay = document.getElementById('auth-overlay');
            const credView = document.getElementById('auth-view-credentials');
            const userView = document.getElementById('auth-view-username');
            if (!overlay) return;
            overlay.classList.remove('hidden');
            if (view === 'credentials') {
                if (credView) credView.classList.remove('hidden');
                if (userView) userView.classList.add('hidden');
            } else {
                if (credView) credView.classList.add('hidden');
                if (userView) userView.classList.remove('hidden');
                const userInp = document.getElementById('input-username');
                if (userInp) {
                    if (authUser && (authUser.displayName || authUser.email)) {
                        const sug = sanitizeUsername(authUser.displayName || authUser.email.split('@')[0]);
                        userInp.value = sug;
                        onUsernameInput(sug);
                    }
                    setTimeout(() => userInp.focus(), 150);
                }
            }
        }

        function hideAuthModal() {
            const overlay = document.getElementById('auth-overlay');
            if (overlay) overlay.classList.add('hidden');
        }

        function hideBootScreen() {
            const b = document.getElementById('boot-screen');
            if (b) b.classList.add('hidden');
        }

        /* ---- Detección de entorno: app instalada vs. navegador web ----
           En las apps empaquetadas (Electron para MSI, WebView/Capacitor/Cordova para
           APK) el dispositivo es personal y conviene una sesión persistente que
           sobreviva al cierre, para poder entrar sin conexión durante el viaje.
           En el navegador web se mantiene la política estricta (cerrar al cerrar la
           pestaña). Se puede forzar el modo con window.__APP_INSTALADA = true/false. */
        function esAppInstalada() {
            try {
                if (typeof window.__APP_INSTALADA === 'boolean') return window.__APP_INSTALADA;
            } catch (e) { /* ignorar */ }
            const ua = (navigator.userAgent || '');
            const cap = (typeof window.Capacitor !== 'undefined') ? window.Capacitor : null;
            const esCapacitor = !!(cap && (
                (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) ||
                (typeof cap.isNative === 'function' && cap.isNative())
            ));
            const esCordova = (typeof window.cordova !== 'undefined');
            const esWebViewAndroid = ua.indexOf('Android') !== -1 && /(wv|webview)/i.test(ua);
            return !!(ua.indexOf('Electron') !== -1 || esCapacitor || esCordova || esWebViewAndroid);
        }

        function hayConexion() {
            return typeof navigator !== 'undefined' && navigator.onLine !== false;
        }

        function actualizarAvisoOffline() {
            const note = document.getElementById('auth-offline-note');
            const btnDraft = document.getElementById('btn-modo-borrador');
            const offline = !hayConexion();
            if (note) note.classList.toggle('hidden', !offline);
            // La opcion de trabajar sin cuenta se ofrece cuando no hay conexion
            // (primera vez en un dispositivo sin internet).
            if (btnDraft) btnDraft.classList.toggle('hidden', !offline);
        }

        function tieneSesionGuardada() {
            // Busca si existe un token de sesión Firebase en el almacenamiento de la
            // pestaña (SESSION → sessionStorage) o del dispositivo (LOCAL →
            // localStorage, apps instaladas). Si existe, la sesión se está restaurando
            // y hay que esperarla antes de pedir el login.
            try {
                const almacenes = [sessionStorage, localStorage];
                for (const st of almacenes) {
                    for (let i = 0; i < st.length; i++) {
                        const k = st.key(i);
                        if (k && k.indexOf('firebase:authUser:') === 0) return true;
                    }
                }
            } catch (e) { /* ignorar */ }
            return false;
        }

        function showAuthError(msg) {
            const el = document.getElementById('auth-error-msg');
            if (el) { el.textContent = msg; el.classList.remove('hidden'); }
        }

        function clearAuthError() {
            const el = document.getElementById('auth-error-msg');
            if (el) { el.textContent = ''; el.classList.add('hidden'); }
            const uEl = document.getElementById('username-error-msg');
            if (uEl) { uEl.textContent = ''; uEl.classList.add('hidden'); }
        }

        function showUsernameError(msg) {
            const el = document.getElementById('username-error-msg');
            if (el) { el.textContent = msg; el.classList.remove('hidden'); }
        }

        function setAuthLoading(loading) {
            const btn = document.getElementById('auth-submit-btn');
            const spinner = document.getElementById('auth-spinner');
            if (btn) btn.disabled = loading;
            if (spinner) spinner.classList.toggle('hidden', !loading);
        }

        function setUsernameLoading(loading) {
            const btn = document.getElementById('username-submit-btn');
            const spinner = document.getElementById('username-spinner');
            if (btn) btn.disabled = loading;
            if (spinner) spinner.classList.toggle('hidden', !loading);
        }

        function getAuthErrorMessage(error) {
            if (!error) return 'Ocurrió un error inesperado.';
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    return 'Correo electrónico o contraseña incorrectos.';
                case 'auth/email-already-in-use':
                    return 'Este correo ya está registrado. Elegí "Iniciar Sesión".';
                case 'auth/invalid-email':
                    return 'El correo electrónico no es válido.';
                case 'auth/weak-password':
                    return 'La contraseña debe tener al menos 6 caracteres.';
                case 'auth/popup-closed-by-user':
                    return 'Se cerró la ventana de Google antes de completar la autenticación.';
                case 'auth/network-request-failed':
                    return 'Error de red. Verificá tu conexión a internet.';
                default:
                    return error.message || 'Error en la autenticación.';
            }
        }

        async function handleAuthSubmit(e) {
            e.preventDefault();
            clearAuthError();
            const email = document.getElementById('auth-email').value.trim();
            const pass = document.getElementById('auth-password').value;
            if (!email || !pass) return showAuthError('Completá todos los campos requeridos.');

            setAuthLoading(true);
            try {
                if (authCurrentTab === 'login') {
                    await firebase.auth().signInWithEmailAndPassword(email, pass);
                } else {
                    const passConf = document.getElementById('auth-password-confirm').value;
                    if (pass !== passConf) {
                        setAuthLoading(false);
                        return showAuthError('Las contraseñas no coinciden.');
                    }
                    await firebase.auth().createUserWithEmailAndPassword(email, pass);
                }
            } catch (err) {
                console.error(err);
                showAuthError(getAuthErrorMessage(err));
            } finally {
                setAuthLoading(false);
            }
        }

        async function loginWithGoogle() {
            clearAuthError();
            setAuthLoading(true);
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            try {
                await firebase.auth().signInWithPopup(provider);
            } catch (err) {
                console.warn('Error signInWithPopup:', err);
                if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
                    try {
                        await firebase.auth().signInWithRedirect(provider);
                        return;
                    } catch (redirErr) {
                        showAuthError(getAuthErrorMessage(redirErr));
                    }
                } else {
                    showAuthError(getAuthErrorMessage(err));
                }
            } finally {
                setAuthLoading(false);
            }
        }

        async function recuperarPassword() {
            const email = prompt("Ingresá tu correo electrónico para restablecer la contraseña:");
            if (!email) return;
            try {
                await firebase.auth().sendPasswordResetEmail(email.trim());
                toast('Se envió un correo de restablecimiento.');
            } catch (err) {
                alert('No se pudo enviar el correo: ' + getAuthErrorMessage(err));
            }
        }

        async function handleUsernameSubmit(e) {
            e.preventDefault();
            const rawVal = document.getElementById('input-username').value;
            const cleanVal = sanitizeUsername(rawVal);
            const err = validateUsernameFormat(cleanVal);
            if (err) return showUsernameError(err);

            if (!authUser || !authUser.uid) {
                return showUsernameError('Error: No se detectó una sesión activa de autenticación.');
            }

            setUsernameLoading(true);
            try {
                // Verificar si ya existe este nombre de usuario en Firebase
                const userSnap = await db.ref(`usernames/${cleanVal}`).once('value');
                if (userSnap.exists() && userSnap.val().uid !== authUser.uid) {
                    setUsernameLoading(false);
                    return showUsernameError(`El nombre @${cleanVal} ya está en uso. Por favor elegí otro.`);
                }

                // Guardar mapeo en Firebase RTDB
                const payload = {
                    uid: authUser.uid,
                    username: cleanVal,
                    email: authUser.email || '',
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                };

                await db.ref(`usernames/${cleanVal}`).set(payload);
                await db.ref(`users/${authUser.uid}`).set(payload);

                currentUsername = cleanVal;
                localStorage.setItem('travelapp_active_user', currentUsername);
                toast(`¡Bienvenido @${currentUsername}!`);
                onUserAuthenticated();
            } catch (err) {
                console.error(err);
                showUsernameError('Error al registrar nombre de usuario: ' + (err.message || err));
            } finally {
                setUsernameLoading(false);
            }
        }

        async function cerrarSesion() {
            if (modoBorrador) { salirModoBorrador(); return; }
            if (!confirm('¿Deseas cerrar tu sesión actual?')) return;
            try {
                if (auth && typeof auth.signOut === 'function') await auth.signOut();
            } catch (e) {
                console.error('Error al cerrar sesión en Firebase:', e);
                // Limpieza de respaldo: si signOut falló, eliminar igualmente las
                // credenciales locales de Firebase para que no se re-autentique al recargar.
                try {
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.indexOf('firebase:authUser:') === 0) keysToRemove.push(k);
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));
                } catch (e2) { console.error(e2); }
            }
            authUser = null;
            currentUsername = null;
            localStorage.removeItem('travelapp_active_user');
            window.location.reload();
        }

        function updateNavigationLinks() {
            const user = getUserRoot();
            const bitacoraBtn = document.getElementById('btn-ver-bitacora');
            if (bitacoraBtn) {
                bitacoraBtn.href = `viaje.html?user=${encodeURIComponent(user)}${currentViajeId ? `&id=${encodeURIComponent(currentViajeId)}` : ''}`;
            }
            const presupuestoBtn = document.getElementById('btn-presupuesto-link');
            if (presupuestoBtn) {
                presupuestoBtn.href = `presupuesto.html?user=${encodeURIComponent(user)}${currentViajeId ? `&id=${encodeURIComponent(currentViajeId)}` : ''}`;
            }
            const scannerBtn = document.getElementById('gasto-scanner-btn');
            if (scannerBtn) {
                scannerBtn.href = `scanner.html?user=${encodeURIComponent(user)}${currentViajeId ? `&id=${encodeURIComponent(currentViajeId)}` : ''}`;
            }

            // En modo borrador las tres páginas funcionan con los datos locales:
            // viaje.html, presupuesto.html y scanner.html leen la misma caché.
            [presupuestoBtn, scannerBtn].forEach(btn => {
                if (!btn) return;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                btn.removeAttribute('title');
                btn.onclick = null;
            });
        }

        function onUserAuthenticated() {
            hideBootScreen(); // sesión confirmada: revelamos el panel (sin parpadeos)
            hideAuthModal();
            // Solo mostrar la barra de usuario si hay un nombre de usuario real.
            // Evita pintar "@null" en escenarios degradados.
            if (currentUsername) {
                const infoBar = document.getElementById('user-info-bar');
                const nameEl = document.getElementById('current-user-name');
                if (infoBar && nameEl) {
                    infoBar.classList.remove('hidden');
                    infoBar.classList.add('flex');
                    nameEl.textContent = modoBorrador ? 'Borrador local (sin cuenta)' : `@${currentUsername}`;
                }
            }
            definirAvisoImportacion(modoBorrador);
            SyncManager.loadQueue();
            updateNavigationLinks();
            initAdminGlobal().then(() => {
                actualizarBadgeComentarios();
                if (typeof importarPuntosPersistidosDelPlugin === 'function') importarPuntosPersistidosDelPlugin();
                // Si quedaron datos sin cuenta de un modo borrador anterior, ofrecerlos importar.
                if (!modoBorrador) setTimeout(ofrecerImportarBorradores, 700);
            });
        }

        /* ---------------- Modo borrador local: estado e importacion ---------------- */
        function hayModoBorradorActivo() {
            try { return localStorage.getItem(DRAFT_FLAG_KEY) === '1'; } catch (e) { return false; }
        }

        function clavesBorrador() {
            const pref = 'travelapp_' + DRAFT_USER;
            const out = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.indexOf(pref) === 0) out.push(k);
                }
            } catch (e) { /* ignorar */ }
            return out;
        }

        function resumenBorradores() {
            // Cuenta viajes y operaciones pendientes guardadas en modo borrador.
            let viajes = 0, pendientes = 0, rutas = 0;
            try {
                const v = getCache('travelapp_' + DRAFT_USER + '_viajes_cache');
                if (Array.isArray(v)) viajes = v.length;
                const q = getCache('travelapp_' + DRAFT_USER + '_syncQueue');
                if (Array.isArray(q)) pendientes = q.length;
                rutas = rutasLocalesDeUsuario(DRAFT_USER).filter(r => r.google.length || r.automatica.length).length;
            } catch (e) { /* ignorar */ }
            return { viajes: viajes, pendientes: pendientes, rutas: rutas, hay: viajes > 0 || pendientes > 0 || rutas > 0 };
        }

        function hayBorradoresPendientes() {
            return clavesBorrador().length > 0 && resumenBorradores().hay;
        }

        function definirAvisoImportacion(mostrar) {
            const b = document.getElementById('banner-borrador');
            if (b) b.classList.toggle('hidden', !mostrar);
        }

        function entrarModoBorrador() {
            modoBorrador = true;
            authUser = null;
            currentUsername = DRAFT_USER;
            try { localStorage.setItem(DRAFT_FLAG_KEY, '1'); } catch (e) {}
            hideBootScreen();
            hideAuthModal();
            const infoBar = document.getElementById('user-info-bar');
            const nameEl = document.getElementById('current-user-name');
            if (infoBar && nameEl) {
                infoBar.classList.remove('hidden');
                infoBar.classList.add('flex');
                nameEl.textContent = 'Borrador local (sin cuenta)';
            }
            definirAvisoImportacion(true);
            SyncManager.loadQueue();
            updateNavigationLinks();
            initAdminGlobal().then(() => {
                actualizarBadgeComentarios();
                if (typeof importarPuntosPersistidosDelPlugin === 'function') importarPuntosPersistidosDelPlugin();
            });
        }

        function salirModoBorrador() {
            // Los datos locales NO se borran: se conservan hasta importarlos o descartarlos.
            if (!confirm('¿Salir del modo borrador? Los datos guardados en este dispositivo se conservan y podrás importarlos al iniciar sesión.')) return;
            modoBorrador = false;
            try { localStorage.removeItem(DRAFT_FLAG_KEY); } catch (e) {}
            currentUsername = null;
            definirAvisoImportacion(false);
            window.location.reload();
        }

        function abrirImportacion() {
            // Abre el login: al autenticarse se ofrece importar automaticamente.
            showAuthModal('credentials');
        }

        async function importarBorradores() {
            const draftQueue = getCache('travelapp_' + DRAFT_USER + '_syncQueue') || [];
            const draftViajes = getCache('travelapp_' + DRAFT_USER + '_viajes_cache') || [];
            const base = getUserRoot();
            let ok = 0, err = 0;

            // 1) Recrear el indice de viajes del borrador (idempotente por id).
            //    Se omiten los viajes que ya tienen su operacion en la cola, para no
            //    escribir dos veces el mismo dato.
            const enCola = new Set();
            for (const op of draftQueue) {
                if (op && op.isGlobal && typeof op.path === 'string' && op.path.indexOf('viajes_index/') === 0) {
                    enCola.add(op.path.slice('viajes_index/'.length));
                }
            }
            for (const v of (Array.isArray(draftViajes) ? draftViajes : [])) {
                if (!v || !v.id || enCola.has(v.id)) continue;
                try {
                    const datos = Object.assign({}, v);
                    delete datos.id;
                    await db.ref(base + '/viajes_index/' + v.id).set(normalizeTimestamps(deepClone(datos), 'server'));
                    ok++;
                } catch (e) { console.error('Error importando viaje', v && v.id, e); err++; }
            }

            // 2) Replay de la cola del borrador bajo la cuenta. La cola guarda rutas
            //    relativas a la raiz del usuario, por lo que es portable.
            for (const op of draftQueue) {
                try {
                    const ref = op.isGlobal
                        ? db.ref(base + '/' + op.path)
                        : db.ref(base + '/viajes_data/' + op.viajeId + '/' + op.path);
                    const payload = (op.data && typeof op.data === 'object' && !Array.isArray(op.data))
                        ? encodeObjectKeys(op.data) : op.data;
                    if (op.action === 'set') await ref.set(normalizeTimestamps(deepClone(payload), 'server'));
                    else if (op.action === 'update') await ref.update(normalizeTimestamps(deepClone(payload), 'server'));
                    else if (op.action === 'remove') await ref.remove();
                    ok++;
                } catch (e) { console.error('Error importando operacion', op, e); err++; }
            }

            // 3) Importar las rutas híbridas guardadas en modo borrador local.
            try {
                const rutasImportadas = await importarRutasDeUsuario(DRAFT_USER, base);
                ok += rutasImportadas;
            } catch (e) {
                console.error('Error importando rutas locales', e);
                err++;
            }
            return { ok: ok, err: err };
        }

        function limpiarBorradores() {
            clavesBorrador().forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
            try { localStorage.removeItem(DRAFT_FLAG_KEY); } catch (e) {}
        }

        function ofrecerImportarBorradores() {
            if (modoBorrador) return;
            if (!hayBorradoresPendientes()) return;
            const modal = document.getElementById('import-modal');
            if (!modal) return;
            const resumen = resumenBorradores();
            const txt = document.getElementById('import-modal-resumen');
            if (txt) {
                const partes = [];
                if (resumen.viajes) partes.push(resumen.viajes + ' viaje' + (resumen.viajes === 1 ? '' : 's'));
                if (resumen.pendientes) partes.push(resumen.pendientes + ' cambio' + (resumen.pendientes === 1 ? '' : 's') + ' sin subir');
                if (resumen.rutas) partes.push(resumen.rutas + ' ruta' + (resumen.rutas === 1 ? '' : 's'));
                txt.textContent = 'Encontramos datos sin cuenta en este dispositivo (' + (partes.join(' y ') || 'datos locales') + '). ¿Querés importarlos a @' + getUserRoot() + '?';
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        async function confirmarImportacion() {
            const modal = document.getElementById('import-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
            toast('Importando datos a tu cuenta…');
            const r = await importarBorradores();
            limpiarBorradores();
            definirAvisoImportacion(false);
            toast(r.err ? ('Importacion con avisos: ' + r.ok + ' ok, ' + r.err + ' con error.') : ('✅ Importados ' + r.ok + ' elementos a tu cuenta.'));
            await initAdminGlobal();
        }

        function descartarImportacion() {
            if (!confirm('¿Descartar los datos guardados sin cuenta en este dispositivo? No se puede deshacer.')) return;
            const modal = document.getElementById('import-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
            limpiarBorradores();
            definirAvisoImportacion(false);
            toast('Datos locales descartados.');
        }

        function mostrarSinFirebase() {
            // Firebase no cargó: ocultamos la carga y el modal, ocultamos la barra de
            // usuario (nada de sesiones falsas) y mostramos un aviso persistente.
            hideBootScreen();
            hideAuthModal();
            const infoBar = document.getElementById('user-info-bar');
            if (infoBar) {
                infoBar.classList.add('hidden');
                infoBar.classList.remove('flex');
            }
            const warn = document.getElementById('fb-warning');
            if (warn) warn.classList.remove('hidden');
        }

        if (FIREBASE_AVAILABLE) {
            try {
                firebase.initializeApp(firebaseConfig);
                db = firebase.database();
                auth = firebase.auth();

                // ---- Política de sesión según el entorno ----
                // • Apps instaladas (Electron/WebView/Capacitor): persistencia LOCAL.
                //   El dispositivo es personal; la sesión sobrevive al cierre de la app
                //   para poder entrar sin conexión durante el viaje. El botón "Salir"
                //   borra esa sesión del dispositivo.
                // • Navegador web: persistencia SESSION. La sesión dura lo que dura la
                //   pestaña (se cierra al cerrarla), como política de privacidad.
                const appInstalada = esAppInstalada();
                if (appInstalada) {
                    try {
                        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err =>
                            console.warn('No se pudo fijar persistencia LOCAL:', err)
                        );
                    } catch (e) {
                        console.warn('Error configurando persistencia LOCAL:', e);
                    }
                } else {
                    // Web: limpiar tokens LOCales viejos (recordarme siempre) y usar SESSION
                    try {
                        const staleKeys = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            if (k && k.indexOf('firebase:authUser:') === 0) staleKeys.push(k);
                        }
                        staleKeys.forEach(k => localStorage.removeItem(k));
                    } catch (e) {
                        console.warn('No se pudieron limpiar tokens de sesión locales:', e);
                    }
                    try {
                        auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err =>
                            console.warn('No se pudo fijar persistencia SESSION:', err)
                        );
                    } catch (e) {
                        console.warn('Error configurando persistencia SESSION:', e);
                    }
                }
            } catch (e) {
                console.warn('Error inicializando Firebase:', e);
            }
        }

        function checkIsOnline() {
            return isFirebaseConnected || (typeof navigator !== 'undefined' && navigator.onLine !== false);
        }

        let currentViajeId = null;

        /* ============================================================
           RUTAS GPS HÍBRIDAS (Google Timeline + respaldo automático)
           ------------------------------------------------------------
           - La ruta automática se guarda primero en el dispositivo.
           - Si se importa Timeline.json, Google pasa a ser la fuente principal.
           - Las dos fuentes se conservan para poder compararlas o cambiar.
           - La sincronización con Firebase ocurre cuando vuelve internet.
           ============================================================ */

        const ROUTE_MAX_POINTS = 30000;
        const ROUTE_DISTANCE_FILTER = 30; // metros: reduce batería y puntos redundantes
        const ROUTE_MAX_ACCURACY = 250;   // descartar lecturas GPS muy imprecisas
        let rutaPlugin = null;
        let rutaPluginModo = null;
        let rutaPluginInicializado = false;
        let rutaPluginReady = false;
        let rutaPluginReadyPromise = Promise.resolve();
        let rutaWatchId = null;
        let rutaImportandoPlugin = false;

        function fechaRutaHoy() {
            const d = new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        function fechaRutaDeTimestamp(ts) {
            const d = new Date(Number(ts));
            if (!Number.isFinite(d.getTime())) return '';
            // Usa la zona horaria configurada en el teléfono, que es la que normalmente
            // corresponde al día que el viajero selecciona en la bitácora.
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        function rutaLocalKey(user, viajeId, fecha) {
            return 'travelapp_' + user + '_ruta_' + encodeURIComponent(String(viajeId || '')) + '_' + fecha;
        }

        function rutaActivaKey(user) {
            return 'travelapp_' + user + '_ruta_activa';
        }

        function rutaVacia(viajeId, fecha) {
            return {
                version: 1,
                viajeId: viajeId,
                fecha: fecha,
                google: [],
                automatica: [],
                fuentePrincipal: null,
                pendingSync: false,
                updatedAt: 0
            };
        }

        function normalizarRutaRecord(record, viajeId, fecha) {
            const r = record && typeof record === 'object' ? record : rutaVacia(viajeId, fecha);
            r.version = r.version || 1;
            r.viajeId = r.viajeId || viajeId;
            r.fecha = r.fecha || fecha;
            r.google = Array.isArray(r.google) ? r.google : [];
            r.automatica = Array.isArray(r.automatica) ? r.automatica : (Array.isArray(r.auto) ? r.auto : []);
            r.fuentePrincipal = r.fuentePrincipal === 'google' || r.fuentePrincipal === 'automatica' ? r.fuentePrincipal : null;
            r.pendingSync = !!r.pendingSync;
            return r;
        }

        function getRutaCache(viajeId, fecha, userOverride) {
            if (!viajeId || !fecha) return rutaVacia(viajeId, fecha);
            const user = userOverride || getUserRoot();
            return normalizarRutaRecord(getCache(rutaLocalKey(user, viajeId, fecha)), viajeId, fecha);
        }

        function setRutaCache(record, userOverride) {
            if (!record || !record.viajeId || !record.fecha) return;
            const user = userOverride || getUserRoot();
            record.updatedAt = Date.now();
            setCache(rutaLocalKey(user, record.viajeId, record.fecha), record);
        }

        function rutasLocalesDeUsuario(user) {
            const pref = 'travelapp_' + user + '_ruta_';
            const out = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k || k.indexOf(pref) !== 0 || k === rutaActivaKey(user)) continue;
                    const r = getCache(k);
                    if (r && r.viajeId && r.fecha) out.push(normalizarRutaRecord(r, r.viajeId, r.fecha));
                }
            } catch (e) { console.warn('No se pudieron listar rutas locales:', e); }
            return out;
        }

        function rutasPendientesLocales() {
            return rutasLocalesDeUsuario(getUserRoot()).filter(r => r.pendingSync && (r.google.length || r.automatica.length));
        }

        function contarRutasPendientes() {
            try { return rutasPendientesLocales().length; } catch (e) { return 0; }
        }

        function getRutaActivaContexto() {
            try { return getCache(rutaActivaKey(getUserRoot())); } catch (e) { return null; }
        }

        function setRutaActivaContexto(ctx) {
            if (ctx) setCache(rutaActivaKey(ctx.user || getUserRoot()), ctx);
            else {
                try { localStorage.removeItem(rutaActivaKey(getUserRoot())); } catch (e) {}
            }
        }

        function distanciaMetros(a, b) {
            if (!a || !b) return Infinity;
            const rad = Math.PI / 180;
            const p1 = Number(a.lat) * rad;
            const p2 = Number(b.lat) * rad;
            const dp = (Number(b.lat) - Number(a.lat)) * rad;
            const dl = (Number(b.lng) - Number(a.lng)) * rad;
            const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
            return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
        }

        function distanciaRutaKm(points) {
            let total = 0;
            for (let i = 1; i < points.length; i++) total += distanciaMetros(points[i - 1], points[i]);
            return total / 1000;
        }

        function formatearDistanciaRuta(km) {
            if (!Number.isFinite(km)) return '—';
            if (km < 1) return Math.round(km * 1000) + ' m';
            return km.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
        }

        function horaPuntoRuta(ts) {
            const d = new Date(Number(ts));
            return Number.isFinite(d.getTime())
                ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—';
        }

        function puntosDeFuenteRuta(record, fuente) {
            if (!record) return [];
            return fuente === 'google' ? (record.google || []) : (record.automatica || []);
        }

        function puntosRutaPrincipal(record) {
            if (!record) return { fuente: null, puntos: [] };
            const google = puntosDeFuenteRuta(record, 'google');
            const auto = puntosDeFuenteRuta(record, 'automatica');
            if (record.fuentePrincipal === 'google' && google.length) return { fuente: 'google', puntos: google };
            if (record.fuentePrincipal === 'automatica' && auto.length) return { fuente: 'automatica', puntos: auto };
            if (google.length) return { fuente: 'google', puntos: google };
            if (auto.length) return { fuente: 'automatica', puntos: auto };
            return { fuente: null, puntos: [] };
        }

        function puntoDesdeLocationPlugin(location) {
            if (!location) return null;
            const c = location.coords || location.coordinate || location;
            const lat = Number(c.latitude != null ? c.latitude : c.lat);
            const lng = Number(c.longitude != null ? c.longitude : (c.lng != null ? c.lng : c.lon));
            const accuracy = Number(c.accuracy != null ? c.accuracy : location.accuracy);
            let ts = location.timestamp || location.ts || c.timestamp || c.ts || Date.now();
            if (typeof ts === 'string') ts = Date.parse(ts);
            if (typeof ts === 'object' && ts && ts.seconds != null) ts = Number(ts.seconds) * 1000;
            ts = Number(ts);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
            return {
                lat: lat,
                lng: lng,
                accuracy: Number.isFinite(accuracy) ? accuracy : null,
                ts: Number.isFinite(ts) ? ts : Date.now(),
                uuid: location.uuid || location.id || null
            };
        }

        function guardarPuntoRutaAutomatica(point, contextOverride) {
            const ctx = contextOverride || getRutaActivaContexto();
            if (!ctx || !ctx.viajeId) return false;
            const p = puntoDesdeLocationPlugin(point);
            if (!p) return false;
            if (p.accuracy != null && p.accuracy > ROUTE_MAX_ACCURACY) return false;
            const fecha = fechaRutaDeTimestamp(p.ts) || ctx.fecha || fechaRutaHoy();
            const record = getRutaCache(ctx.viajeId, fecha, ctx.user || getUserRoot());
            const arr = record.automatica;

            if (p.uuid && arr.some(x => x.uuid && x.uuid === p.uuid)) return false;
            const ultimo = arr[arr.length - 1];
            if (ultimo && !p.uuid && Math.abs(Number(ultimo.ts) - p.ts) < 10000 && distanciaMetros(ultimo, p) < 5) return false;

            arr.push(p);
            if (arr.length > ROUTE_MAX_POINTS) arr.splice(0, arr.length - ROUTE_MAX_POINTS);
            record.pendingSync = true;
            if (!record.fuentePrincipal) record.fuentePrincipal = 'automatica';
            setRutaCache(record, ctx.user || getUserRoot());

            const selectedDate = document.getElementById('ruta-fecha') && document.getElementById('ruta-fecha').value;
            if (ctx.viajeId === currentViajeId && selectedDate === fecha) renderRutaUI(record);
            return true;
        }

        function marcarRutaStatus(text, kind) {
            const el = document.getElementById('ruta-status');
            if (!el) return;
            el.textContent = text;
            el.className = 'text-sm rounded-xl px-4 py-3 mb-4 border ' + (
                kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                kind === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                'bg-gray-50 border-gray-200 text-gray-700'
            );
        }

        function renderRutaCanvas(points) {
            const canvas = document.getElementById('ruta-canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const cssW = Math.max(280, Math.round(rect.width || canvas.parentElement?.clientWidth || 600));
            const cssH = 280;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = cssW * dpr;
            canvas.height = cssH * dpr;
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
            ctx.fillStyle = '#f9fafb';
            ctx.fillRect(0, 0, cssW, cssH);

            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1;
            for (let x = 0; x <= cssW; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke(); }
            for (let y = 0; y <= cssH; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke(); }

            if (!points || points.length === 0) {
                ctx.fillStyle = '#9ca3af';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Todavía no hay puntos para este día', cssW / 2, cssH / 2);
                return;
            }

            const valid = points.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
            const minLat = Math.min(...valid.map(p => Number(p.lat)));
            const maxLat = Math.max(...valid.map(p => Number(p.lat)));
            const minLng = Math.min(...valid.map(p => Number(p.lng)));
            const maxLng = Math.max(...valid.map(p => Number(p.lng)));
            const latSpan = Math.max(maxLat - minLat, 0.00001);
            const lngSpan = Math.max(maxLng - minLng, 0.00001);
            const pad = 24;
            const scale = Math.min((cssW - pad * 2) / lngSpan, (cssH - pad * 2) / latSpan);
            const offsetX = (cssW - lngSpan * scale) / 2;
            const offsetY = (cssH - latSpan * scale) / 2;
            const xy = p => [offsetX + (Number(p.lng) - minLng) * scale, cssH - (offsetY + (Number(p.lat) - minLat) * scale)];

            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            valid.forEach((p, i) => { const [x, y] = xy(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
            ctx.stroke();

            const first = xy(valid[0]);
            const last = xy(valid[valid.length - 1]);
            ctx.fillStyle = '#059669';
            ctx.beginPath(); ctx.arc(first[0], first[1], 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#dc2626';
            ctx.beginPath(); ctx.arc(last[0], last[1], 6, 0, Math.PI * 2); ctx.fill();
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#047857'; ctx.fillText('Inicio', first[0] + 8, first[1] - 8);
            ctx.fillStyle = '#b91c1c'; ctx.fillText('Fin', last[0] + 8, last[1] - 8);
        }

        function resumenRutaFuente(points, emptyText) {
            if (!points || !points.length) return emptyText;
            const km = distanciaRutaKm(points);
            const inicio = horaPuntoRuta(points[0].ts);
            const fin = horaPuntoRuta(points[points.length - 1].ts);
            return points.length + ' puntos · ' + formatearDistanciaRuta(km) + ' · ' + inicio + '–' + fin;
        }

        function renderRutaUI(record) {
            if (!record) return;
            const google = record.google || [];
            const auto = record.automatica || [];
            const principal = puntosRutaPrincipal(record);
            const googleEl = document.getElementById('ruta-google-resumen');
            const autoEl = document.getElementById('ruta-auto-resumen');
            const mainEl = document.getElementById('ruta-principal-resumen');
            const statsEl = document.getElementById('ruta-stats');
            const btnGoogle = document.getElementById('btn-usar-ruta-google');
            const btnAuto = document.getElementById('btn-usar-ruta-auto');
            if (googleEl) googleEl.textContent = resumenRutaFuente(google, 'Sin datos importados');
            if (autoEl) autoEl.textContent = resumenRutaFuente(auto, 'Sin puntos registrados');
            if (mainEl) mainEl.textContent = principal.puntos.length
                ? (principal.fuente === 'google' ? 'Google Maps · ' : 'Automática · ') + resumenRutaFuente(principal.puntos, '')
                : 'Sin ruta seleccionada';
            if (statsEl) statsEl.textContent = principal.puntos.length
                ? (principal.puntos.length + ' puntos · ' + formatearDistanciaRuta(distanciaRutaKm(principal.puntos)))
                : '';
            if (btnGoogle) btnGoogle.classList.toggle('hidden', google.length === 0);
            if (btnAuto) btnAuto.classList.toggle('hidden', auto.length === 0);
            renderRutaCanvas(principal.puntos);

            const ctx = getRutaActivaContexto();
            if (ctx && ctx.viajeId === record.viajeId) {
                marcarRutaStatus('🛰 Seguimiento automático activo. Los puntos se guardan en el dispositivo y se subirán al volver la conexión.', 'ok');
            } else if (record.pendingSync) {
                marcarRutaStatus('📴 Ruta guardada localmente. Queda pendiente de sincronización cuando haya internet.', 'warn');
            } else if (principal.puntos.length) {
                marcarRutaStatus('Ruta cargada. Fuente principal: ' + (principal.fuente === 'google' ? 'Google Maps' : 'automática') + '.', 'ok');
            } else {
                marcarRutaStatus('No hay ruta registrada para este día.', '');
            }
        }

        async function cargarRutaDelDia() {
            const fechaEl = document.getElementById('ruta-fecha');
            if (!fechaEl || !currentViajeId) return;
            const fecha = fechaEl.value || fechaRutaHoy();
            fechaEl.value = fecha;
            let local = getRutaCache(currentViajeId, fecha);

            // La base online complementa la caché, pero nunca pisa una ruta local
            // pendiente: el teléfono puede haber trabajado todo el día offline.
            if (FIREBASE_AVAILABLE && checkIsOnline() && !modoBorrador) {
                try {
                    const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/rutas/${fecha}`).once('value'), 7000);
                    if (snap.exists()) {
                        const server = normalizarRutaRecord(snap.val(), currentViajeId, fecha);
                        if (!local.pendingSync) {
                            local = server;
                            setRutaCache(local);
                        } else {
                            if (!local.google.length && server.google.length) local.google = server.google;
                            if (!local.automatica.length && server.automatica.length) local.automatica = server.automatica;
                            if (!local.fuentePrincipal) local.fuentePrincipal = server.fuentePrincipal;
                        }
                    }
                } catch (e) { console.warn('No se pudo descargar la ruta:', e); }
            }
            renderRutaUI(local);
        }

        function elegirFuenteRuta(fuente) {
            if (!currentViajeId) return toast('Seleccioná un viaje primero');
            const fecha = document.getElementById('ruta-fecha').value || fechaRutaHoy();
            const record = getRutaCache(currentViajeId, fecha);
            const puntos = puntosDeFuenteRuta(record, fuente);
            if (!puntos.length) return toast('No hay puntos disponibles para esa fuente.');
            record.fuentePrincipal = fuente;
            record.pendingSync = true;
            setRutaCache(record);
            renderRutaUI(record);
            toast('Fuente principal: ' + (fuente === 'google' ? 'Google Maps' : 'ruta automática'));
        }

        function guardarRutaDelDia() {
            if (!currentViajeId) return toast('Seleccioná un viaje primero');
            const fecha = document.getElementById('ruta-fecha').value || fechaRutaHoy();
            const record = getRutaCache(currentViajeId, fecha);
            const principal = puntosRutaPrincipal(record);
            if (!principal.puntos.length) return toast('No hay una ruta para guardar.');
            record.fuentePrincipal = principal.fuente;
            record.pendingSync = true;
            setRutaCache(record);
            renderRutaUI(record);
            toast('✅ Selección de ruta guardada localmente.');
            SyncManager.updateUI();
        }

        async function sincronizarRutasAhora() {
            if (!FIREBASE_AVAILABLE || !checkIsOnline() || modoBorrador) {
                toast(modoBorrador ? '🧾 Iniciá sesión para subir las rutas.' : '📴 No hay conexión; las rutas quedan guardadas localmente.');
                return;
            }
            try {
                const n = await syncRutasLocales();
                toast(n ? '✅ Rutas sincronizadas: ' + n : 'No hay rutas pendientes.');
                await cargarRutaDelDia();
                SyncManager.updateUI();
            } catch (e) {
                console.error(e);
                toast('❌ No se pudieron sincronizar las rutas: ' + (e.message || e));
            }
        }

        async function syncRutasLocales() {
            if (!FIREBASE_AVAILABLE || !db || !checkIsOnline() || modoBorrador || !currentUsername) return 0;
            const pendientes = rutasPendientesLocales();
            let ok = 0;
            for (const record of pendientes) {
                const payload = deepClone(record);
                delete payload.pendingSync;
                try {
                    await withTimeout(db.ref(`${getUserRoot()}/viajes_data/${record.viajeId}/rutas/${record.fecha}`).set(payload), TIMEOUT_MS);
                    record.pendingSync = false;
                    setRutaCache(record);
                    ok++;
                } catch (e) {
                    console.warn('Ruta pendiente no sincronizada', record.viajeId, record.fecha, e);
                    throw e;
                }
            }
            return ok;
        }

        async function importarRutasDeUsuario(origenUser, destinoUser) {
            if (!db) return 0;
            const rutas = rutasLocalesDeUsuario(origenUser);
            let ok = 0;
            for (const record of rutas) {
                const payload = deepClone(record);
                delete payload.pendingSync;
                await db.ref(`${destinoUser}/viajes_data/${record.viajeId}/rutas/${record.fecha}`).set(payload);
                const copia = normalizarRutaRecord(payload, record.viajeId, record.fecha);
                copia.pendingSync = false;
                setRutaCache(copia, destinoUser);
                ok++;
            }
            return ok;
        }

        function parseTimestampRuta(value) {
            if (value == null || value === '') return null;
            if (typeof value === 'object') {
                if (value.seconds != null) return Number(value.seconds) * 1000 + Math.round(Number(value.nanoseconds || 0) / 1000000);
                return null;
            }
            if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
                let n = Number(value);
                if (n < 100000000000) n *= 1000; // segundos Unix
                return Number.isFinite(n) ? n : null;
            }
            const n = Date.parse(String(value));
            return Number.isFinite(n) ? n : null;
        }

        function coordsDesdeTimeline(value) {
            if (value == null) return null;
            if (typeof value === 'string') {
                const s = value.trim().replace(/^geo:/i, '');
                // Acepta el formato nuevo de exportación de Google con símbolo de
                // grados: "-34.8804161°, -56.1862484°", además del clásico "lat, lng".
                const m = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?/);
                if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
                return null;
            }
            if (typeof value !== 'object') return null;
            if (value.latitudeE7 != null && value.longitudeE7 != null) return { lat: Number(value.latitudeE7) / 1e7, lng: Number(value.longitudeE7) / 1e7 };
            if (value.latE7 != null && value.lngE7 != null) return { lat: Number(value.latE7) / 1e7, lng: Number(value.lngE7) / 1e7 };
            if (value.latitude != null && value.longitude != null) return { lat: Number(value.latitude), lng: Number(value.longitude) };
            if (value.lat != null && (value.lng != null || value.lon != null)) return { lat: Number(value.lat), lng: Number(value.lng != null ? value.lng : value.lon) };
            const nestedKeys = ['point', 'latLng', 'geo', 'location', 'placeLocation', 'startLocation', 'endLocation'];
            for (const key of nestedKeys) {
                if (value[key] != null) {
                    const c = coordsDesdeTimeline(value[key]);
                    if (c) return c;
                }
            }
            return null;
        }

        let ultimaLimpiezaTimeline = 0; // puntos descartados por redundancia en el último parse

        function parseGoogleTimelineJson(data) {
            const out = [];
            const seen = new Set();
            ultimaLimpiezaTimeline = 0;
            const add = (coords, ts, accuracy, horaPropia) => {
                if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return;
                const t = parseTimestampRuta(ts);
                if (!t) return;
                const p = { lat: coords.lat, lng: coords.lng, ts: t, accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null, _h: horaPropia ? 1 : 0 };
                const key = p.lat.toFixed(6) + '|' + p.lng.toFixed(6) + '|' + p.ts;
                if (seen.has(key)) return;
                seen.add(key);
                out.push(p);
            };

            // Claves con la hora del PROPIO punto (no heredada del segmento que lo contiene)
            const HORAS_PROPIAS = ['timestampMs', 'timestamp', 'time'];

            const pointTimestamp = (obj, fallback) => {
                if (!obj || typeof obj !== 'object') return fallback;
                return obj.timestampMs || obj.timestamp || obj.time || obj.startTimestamp || obj.startTime || obj.startTimestampMs ||
                    (obj.duration && (obj.duration.startTimestamp || obj.duration.startTime || obj.duration.startTimestampMs)) || fallback;
            };

            // Las claves que representan la LLEGADA de un segmento deben llevar la
            // hora de FIN del tramo; si se sellan con la de inicio, al ordenar por
            // hora el destino queda pegado al origen y el reproductor dibuja
            // primero una línea recta origen→destino.
            const endTimestamp = (obj, fallback) => {
                if (!obj || typeof obj !== 'object') return fallback;
                return obj.endTimestamp || obj.endTime || obj.endTimestampMs ||
                    (obj.duration && (obj.duration.endTimestamp || obj.duration.endTime || obj.duration.endTimestampMs)) || fallback;
            };
            const esClaveLlegada = (key) => /^(end|endlocation|destination)$/i.test(key);

            const parsePathArray = (arr, fallbackTs) => {
                if (!Array.isArray(arr)) return;
                arr.forEach(item => {
                    if (typeof item === 'string') add(coordsDesdeTimeline(item), fallbackTs, null, false);
                    else if (item && typeof item === 'object') {
                        const propio = HORAS_PROPIAS.some(k => item[k] != null);
                        add(coordsDesdeTimeline(item), pointTimestamp(item, fallbackTs), item.accuracy || (item.coords && item.coords.accuracy), propio);
                    }
                });
            };

            const CLAVES_PATH = ['timelinePath', 'waypointPath', 'path', 'points', 'locations', 'rawLocations', 'waypoints'];

            const walk = (node, fallbackTs, fallbackEndTs, depth) => {
                if (!node || depth > 12) return;
                if (Array.isArray(node)) { node.forEach(x => walk(x, fallbackTs, fallbackEndTs, depth + 1)); return; }
                if (typeof node !== 'object') return;
                const ownTs = pointTimestamp(node, fallbackTs);
                const ownEndTs = endTimestamp(node, fallbackEndTs);
                const ownCoords = coordsDesdeTimeline(node);
                if (ownCoords) add(ownCoords, ownTs, node.accuracy || (node.coords && node.coords.accuracy), HORAS_PROPIAS.some(k => node[k] != null));
                CLAVES_PATH.forEach(key => {
                    if (Array.isArray(node[key])) parsePathArray(node[key], ownTs);
                    else if (node[key] && typeof node[key] === 'object') {
                        // Formato clásico: waypointPath viene como { waypoints: [...] }
                        walk(node[key], ownTs, ownEndTs, depth + 1);
                    }
                });
                Object.keys(node).forEach(key => {
                    if (['settings', 'userLocationProfile', 'placeVisit', 'visit', 'topCandidate'].includes(key)) {
                        // Los lugares pueden aportar extremos, pero no deben llenar la ruta
                        // con toda la metadata de Google.
                        if (key === 'placeVisit' || key === 'visit') walk(node[key], ownTs, ownEndTs, depth + 1);
                        return;
                    }
                    const v = node[key];
                    if (v && typeof v === 'object' && !CLAVES_PATH.includes(key)) {
                        walk(v, esClaveLlegada(key) ? ownEndTs : ownTs, ownEndTs, depth + 1);
                    }
                });
            };

            /* Si un segmento tiene al menos 3 puntos con hora PROPIA, su camino granular
               ya cuenta el recorrido: los puntos sellados con horas heredadas del tramo
               (extremos de activity, paths en texto plano) son una segunda copia que
               dibuja la ruta dos veces y genera las rectas origen↔destino. Se descartan.
               Si NO hay camino con horas (Takeout clásico, vuelos sin detalle), se
               conserva todo: es la única geometría disponible. */
            const limpiarSegmento = (desde, hasta) => {
                const pts = out.slice(desde, hasta);
                if (!pts.length) return;
                const conHoraPropia = pts.filter(p => p._h).length;
                if (conHoraPropia >= 3) {
                    const limpios = pts.filter(p => p._h);
                    ultimaLimpiezaTimeline += (pts.length - limpios.length);
                    out.splice(desde, hasta - desde, ...limpios);
                }
            };
            const incorporar = (x) => {
                const antes = out.length;
                walk(x, null, null, 0);
                limpiarSegmento(antes, out.length);
            };

            const distM = (a, b) => {
                const r = Math.PI / 180;
                const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
                return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
            };

            // Quita la "punta" de una recta de ida y vuelta: B queda a kilómetros de
            // A y de C, pero A y C están juntos → la recta era un artefacto del sello
            // de hora, no un desplazamiento real.
            const quitarPuntasDeRecta = (pts) => {
                if (!Array.isArray(pts) || pts.length < 4) return pts;
                let arr = pts;
                for (let pasada = 0; pasada < 2; pasada++) {
                    const res = [arr[0]];
                    for (let i = 1; i < arr.length - 1; i++) {
                        const a = res[res.length - 1], b = arr[i], c = arr[i + 1];
                        const dAB = distM(a, b), dBC = distM(b, c), dAC = distM(a, c);
                        const umbralVecinos = Math.max(1500, Math.min(dAB, dBC) / 4);
                        if (dAB >= 3000 && dBC >= 3000 && dAC <= umbralVecinos) {
                            ultimaLimpiezaTimeline++;
                            continue;
                        }
                        res.push(b);
                    }
                    res.push(arr[arr.length - 1]);
                    arr = res;
                }
                return arr;
            };

            // Formato clásico Records.json y formatos semánticos mensuales.
            if (data && Array.isArray(data.locations)) parsePathArray(data.locations, null);
            if (data && Array.isArray(data.timelineObjects)) data.timelineObjects.forEach(incorporar);
            if (data && Array.isArray(data.semanticSegments)) data.semanticSegments.forEach(incorporar);
            if (data && Array.isArray(data.timelineSegments)) data.timelineSegments.forEach(incorporar);
            // Formato de exportación del teléfono: si no encontramos estructuras
            // conocidas, se recorre el objeto completo buscando puntos geo: y lat/lng.
            if (!out.length) walk(data, null, null, 0);

            // Filtra velocidades imposibles: Google a veces mezcla estimaciones con
            // el reloj desordenado (puntos "adelantados" o "rezagados") y generan
            // avance→retroceso→avance falsos. >~200 km/h entre puntos cercanos en el
            // tiempo, o >150 m con el mismo timestamp → el punto es espurio.
            const quitarVelocidadesImposibles = (pts) => {
                if (!Array.isArray(pts) || pts.length < 3) return pts;
                const VMAX_MS = 55.5;
                const res = [pts[0]];
                for (let i = 1; i < pts.length; i++) {
                    const prev = res[res.length - 1];
                    const dt = (Number(pts[i].ts) - Number(prev.ts)) / 1000;
                    const d = distM(prev, pts[i]);
                    if (d > 150 && dt < 120 && (dt <= 0 || d / dt > VMAX_MS)) {
                        ultimaLimpiezaTimeline++;
                        continue;
                    }
                    res.push(pts[i]);
                }
                return res;
            };

            // Ordenar por hora ANTES de los filtros geométricos/de velocidad:
            // ambos analizan la secuencia tal como se va a reproducir.
            out.sort((a, b) => a.ts - b.ts);
            const limpio = quitarVelocidadesImposibles(quitarPuntasDeRecta(out));
            // Quita la marca interna _h antes de devolver los puntos
            limpio.forEach(p => { delete p._h; });
            return limpio;
        }

        async function importarArchivoTimeline(file) {
            if (!file) return;
            const status = document.getElementById('timeline-import-status');
            const fecha = document.getElementById('ruta-fecha').value || fechaRutaHoy();
            if (!currentViajeId) return toast('Seleccioná un viaje antes de importar una ruta.');
            if (status) { status.classList.remove('hidden'); status.textContent = '⏳ Leyendo exportación de Google Maps…'; }
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const todos = parseGoogleTimelineJson(data);
                const puntos = todos.filter(p => fechaRutaDeTimestamp(p.ts) === fecha);
                if (!puntos.length) {
                    if (status) {
                        if (todos.length) {
                            const diasConPuntos = [...new Set(todos.map(p => fechaRutaDeTimestamp(p.ts)).filter(Boolean))].sort();
                            const resumen = diasConPuntos.length <= 4
                                ? diasConPuntos.join(', ')
                                : diasConPuntos[0] + ' … ' + diasConPuntos[diasConPuntos.length - 1] + ' (' + diasConPuntos.length + ' días)';
                            status.textContent = '⚠️ Detecté ' + todos.length + ' puntos de Google, pero ninguno cae en el día ' + fecha +
                                ' según la zona horaria de este dispositivo. Días con puntos: ' + resumen + '.';
                        } else {
                            status.textContent = 'No se encontraron puntos GPS en el archivo. Verificá que sea la exportación de Timeline del teléfono.';
                        }
                    }
                    return toast('No hay puntos de Google Maps para ese día.');
                }
                const record = getRutaCache(currentViajeId, fecha);
                record.google = puntos;
                record.fuentePrincipal = 'google';
                record.pendingSync = true;
                record.googleImportadoAt = Date.now();
                record.googleArchivo = file.name || 'Timeline.json';
                setRutaCache(record);
                renderRutaUI(record);
                if (status) {
                    status.textContent = '✅ Importados ' + puntos.length + ' puntos de Google Maps para ' + fecha + '.' +
                        (ultimaLimpiezaTimeline > 0 ? ' Se descartaron ' + ultimaLimpiezaTimeline + ' puntos redundantes del archivo (extremos duplicados y puntas de rectas).' : '');
                }
                toast('✅ Ruta de Google Maps importada.');
                SyncManager.updateUI();
            } catch (e) {
                console.error('Error leyendo Timeline:', e);
                if (status) status.textContent = '❌ El archivo no parece ser un JSON válido de Google Timeline.';
                toast('No se pudo leer la exportación de Google Maps.');
            }
        }

        function seleccionarArchivoTimeline() {
            const input = document.getElementById('timeline-file-input');
            if (!input) return;
            input.value = '';
            input.click();
        }

        function pluginGetLocations() {
            return new Promise((resolve, reject) => {
                if (!rutaPlugin || typeof rutaPlugin.getLocations !== 'function') return resolve([]);
                let settled = false;
                const ok = v => { if (!settled) { settled = true; resolve(Array.isArray(v) ? v : []); } };
                const fail = e => { if (!settled) { settled = true; reject(e); } };
                try {
                    const r = rutaPlugin.getLocations(ok, fail);
                    if (r && typeof r.then === 'function') r.then(ok).catch(fail);
                } catch (e) { fail(e); }
            });
        }

        async function importarPuntosPersistidosDelPlugin(contextOverride) {
            if (rutaImportandoPlugin || !rutaPlugin || typeof rutaPlugin.getLocations !== 'function') return;
            const ctx = contextOverride || getRutaActivaContexto();
            if (!ctx || !ctx.viajeId) return;
            rutaImportandoPlugin = true;
            try {
                const locations = await pluginGetLocations();
                const desde = Number(ctx.startedAt || 0) - 2 * 60 * 60 * 1000;
                locations.forEach(location => {
                    const p = puntoDesdeLocationPlugin(location);
                    if (p && (!desde || p.ts >= desde)) guardarPuntoRutaAutomatica(p, ctx);
                });
            } catch (e) { console.warn('No se pudieron recuperar puntos offline del plugin:', e); }
            finally { rutaImportandoPlugin = false; }
        }

        function iniciarPluginTransistorsoft() {
            const bg = rutaPlugin;
            if (!bg || typeof bg.ready !== 'function' || typeof bg.onLocation !== 'function') return false;
            try {
                bg.onLocation(location => guardarPuntoRutaAutomatica(location), error => console.warn('Error de ubicación:', error));
                if (typeof bg.onProviderChange === 'function') bg.onProviderChange(ev => {
                    if (ev && ev.enabled === false) marcarRutaStatus('⚠️ La ubicación del dispositivo está desactivada.', 'warn');
                });
                const desiredAccuracy = bg.DesiredAccuracy && bg.DesiredAccuracy.High != null
                    ? bg.DesiredAccuracy.High
                    : (bg.DESIRED_ACCURACY_HIGH != null ? bg.DESIRED_ACCURACY_HIGH : -1);
                const persistAll = bg.PersistMode && bg.PersistMode.All != null
                    ? bg.PersistMode.All
                    : (bg.PERSIST_MODE_ALL != null ? bg.PERSIST_MODE_ALL : (bg.PERSIST_MODE_LOCATION != null ? bg.PERSIST_MODE_LOCATION : 2));
                // v5 usa grupos geolocation/app/persistence/http. Las propiedades
                // planas se dejan también para que la misma página tolere v4.
                const config = {
                    geolocation: {
                        desiredAccuracy: desiredAccuracy,
                        distanceFilter: ROUTE_DISTANCE_FILTER,
                        locationUpdateInterval: 60000,
                        fastestLocationUpdateInterval: 30000,
                        stopTimeout: 5,
                        locationAuthorizationRequest: 'Always'
                    },
                    app: {
                        stopOnTerminate: false,
                        startOnBoot: false,
                        enableHeadless: true,
                        backgroundPermissionRationale: {
                            title: 'Permitir ubicación en segundo plano',
                            message: 'La Bitácora necesita registrar el recorrido aunque la pantalla esté bloqueada.',
                            positiveAction: 'Cambiar a "{backgroundPermissionOptionLabel}"',
                            negativeAction: 'Cancelar'
                        },
                        notification: {
                            title: 'Bitácora de Viaje',
                            text: 'Registrando recorrido offline',
                            color: '#d97706'
                        }
                    },
                    persistence: {
                        maxDaysToPersist: 14,
                        maxRecordsToPersist: ROUTE_MAX_POINTS,
                        persistMode: persistAll
                    },
                    http: { autoSync: false },
                    // Compatibilidad con v4 del plugin.
                    desiredAccuracy: desiredAccuracy,
                    distanceFilter: ROUTE_DISTANCE_FILTER,
                    locationUpdateInterval: 60000,
                    fastestLocationUpdateInterval: 30000,
                    stopTimeout: 5,
                    stopOnTerminate: false,
                    startOnBoot: false,
                    enableHeadless: true,
                    foregroundService: true,
                    notificationTitle: 'Bitácora de Viaje',
                    notificationText: 'Registrando recorrido offline',
                    notificationColor: '#d97706',
                    autoSync: false,
                    maxDaysToPersist: 14,
                    persistMode: persistAll
                };
                const readyCallback = () => {
                    rutaPluginReady = true;
                    importarPuntosPersistidosDelPlugin();
                };
                const result = bg.ready(config, readyCallback);
                if (result && typeof result.then === 'function') {
                    rutaPluginReadyPromise = result.then(() => { rutaPluginReady = true; importarPuntosPersistidosDelPlugin(); return true; });
                } else {
                    rutaPluginReadyPromise = Promise.resolve();
                }
                return true;
            } catch (e) { console.warn('No se pudo inicializar BackgroundGeolocation:', e); return false; }
        }

        function iniciarPluginBackgroundLegacy() {
            const bg = rutaPlugin;
            if (!bg || typeof bg.configure !== 'function') return false;
            try {
                const callback = location => guardarPuntoRutaAutomatica(location);
                const fail = error => console.warn('Error de ubicación en plugin:', error);
                bg.configure(callback, fail, {
                    desiredAccuracy: 10,
                    stationaryRadius: 25,
                    distanceFilter: ROUTE_DISTANCE_FILTER,
                    interval: 60000,
                    fastestInterval: 30000,
                    stopOnTerminate: false,
                    startOnBoot: false,
                    startForeground: true,
                    notificationTitle: 'Bitácora de Viaje',
                    notificationText: 'Registrando recorrido offline',
                    maxLocations: ROUTE_MAX_POINTS
                });
                rutaPluginReady = true;
                return true;
            } catch (e) { console.warn('No se pudo configurar el plugin de ruta:', e); return false; }
        }

        function initRutaCordovaPlugin() {
            if (rutaPluginInicializado) return;
            const ts = window.BackgroundGeolocation;
            const legacy = window.backgroundGeolocation || (window.plugins && (window.plugins.backgroundGeolocation || window.plugins.backgroundLocationServices));
            rutaPlugin = ts || legacy || null;
            const badge = document.getElementById('ruta-plataforma-badge');
            if (!rutaPlugin) {
                if (badge) badge.textContent = (window.cordova ? 'Cordova · plugin pendiente' : 'Web · seguimiento en primer plano');
                return;
            }
            rutaPluginInicializado = true;
            if (typeof rutaPlugin.ready === 'function' && typeof rutaPlugin.onLocation === 'function') {
                rutaPluginModo = 'transistorsoft';
                if (badge) { badge.textContent = 'Cordova · background GPS'; badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800'; }
                iniciarPluginTransistorsoft();
            } else if (typeof rutaPlugin.configure === 'function') {
                rutaPluginModo = 'legacy';
                if (badge) { badge.textContent = 'Cordova · background GPS'; badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800'; }
                iniciarPluginBackgroundLegacy();
            } else {
                if (badge) badge.textContent = 'Cordova · API GPS no reconocida';
            }
        }

        async function iniciarRutaAutomatica() {
            if (!currentViajeId) return toast('Seleccioná o creá un viaje primero.');
            const fecha = document.getElementById('ruta-fecha').value || fechaRutaHoy();
            const ctx = { user: getUserRoot(), viajeId: currentViajeId, fecha: fecha, startedAt: Date.now() };
            setRutaActivaContexto(ctx);
            const btn = document.getElementById('btn-ruta-iniciar');
            try {
                initRutaCordovaPlugin();
                if (rutaPlugin && rutaPluginModo === 'transistorsoft' && typeof rutaPlugin.start === 'function') {
                    await rutaPluginReadyPromise;
                    const result = rutaPlugin.start();
                    if (result && typeof result.then === 'function') await result;
                } else if (rutaPlugin && rutaPluginModo === 'legacy' && typeof rutaPlugin.start === 'function') {
                    rutaPlugin.start();
                } else if (navigator.geolocation) {
                    rutaWatchId = navigator.geolocation.watchPosition(
                        position => guardarPuntoRutaAutomatica(position),
                        error => { console.warn('Geolocalización web:', error); marcarRutaStatus('⚠️ No se pudo obtener la ubicación: ' + error.message, 'warn'); },
                        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
                    );
                } else {
                    setRutaActivaContexto(null);
                    return toast('Este dispositivo no dispone de geolocalización.');
                }
                if (btn) btn.disabled = true;
                actualizarControlesRuta();
                renderRutaUI(getRutaCache(currentViajeId, fecha));
                toast('🛰 Seguimiento automático iniciado.');
            } catch (e) {
                console.error('No se pudo iniciar el seguimiento:', e);
                setRutaActivaContexto(null);
                toast('No se pudo iniciar el seguimiento GPS. Revisá los permisos.');
            }
        }

        async function detenerRutaAutomatica() {
            const ctx = getRutaActivaContexto();
            if (!ctx) return toast('No hay un seguimiento automático activo.');
            try {
                await importarPuntosPersistidosDelPlugin(ctx);
                if (rutaPlugin && rutaPluginModo === 'transistorsoft' && typeof rutaPlugin.stop === 'function') {
                    const result = rutaPlugin.stop();
                    if (result && typeof result.then === 'function') await result;
                } else if (rutaPlugin && rutaPluginModo === 'legacy' && typeof rutaPlugin.stop === 'function') {
                    rutaPlugin.stop();
                }
                if (rutaWatchId !== null && navigator.geolocation) {
                    navigator.geolocation.clearWatch(rutaWatchId);
                    rutaWatchId = null;
                }
            } catch (e) { console.warn('Error deteniendo seguimiento:', e); }
            setRutaActivaContexto(null);
            actualizarControlesRuta();
            const record = getRutaCache(ctx.viajeId, ctx.fecha, ctx.user || getUserRoot());
            if (!record.fuentePrincipal && record.automatica.length) record.fuentePrincipal = 'automatica';
            record.pendingSync = true;
            setRutaCache(record, ctx.user || getUserRoot());
            renderRutaUI(record);
            SyncManager.updateUI();
            toast('⏹ Seguimiento finalizado. Ruta guardada localmente.');
        }

        function actualizarControlesRuta() {
            const ctx = getRutaActivaContexto();
            const iniciar = document.getElementById('btn-ruta-iniciar');
            const detener = document.getElementById('btn-ruta-detener');
            const activaParaViaje = !!(ctx && currentViajeId && ctx.viajeId === currentViajeId);
            if (iniciar) { iniciar.classList.toggle('hidden', activaParaViaje); iniciar.disabled = false; }
            if (detener) detener.classList.toggle('hidden', !activaParaViaje);
        }

        function initRutasUI() {
            const fechaEl = document.getElementById('ruta-fecha');
            if (fechaEl && !fechaEl.value) fechaEl.value = fechaRutaHoy();
            initRutaCordovaPlugin();
            actualizarControlesRuta();
            cargarRutaDelDia();
            importarPuntosPersistidosDelPlugin();
        }

        document.addEventListener('deviceready', () => {
            try { window.__APP_INSTALADA = true; } catch (e) {}
            initRutaCordovaPlugin();
            importarPuntosPersistidosDelPlugin();
        }, false);
        window.addEventListener('resume', () => {
            initRutaCordovaPlugin();
            importarPuntosPersistidosDelPlugin();
            const fechaEl = document.getElementById('ruta-fecha');
            if (fechaEl && document.getElementById('tab-ruta') && !document.getElementById('tab-ruta').classList.contains('hidden')) cargarRutaDelDia();
        });
        window.addEventListener('resize', () => {
            const fechaEl = document.getElementById('ruta-fecha');
            if (fechaEl && document.getElementById('tab-ruta') && !document.getElementById('tab-ruta').classList.contains('hidden')) {
                renderRutaUI(getRutaCache(currentViajeId, fechaEl.value || fechaRutaHoy()));
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            const input = document.getElementById('timeline-file-input');
            if (input) input.addEventListener('change', () => {
                if (input.files && input.files[0]) importarArchivoTimeline(input.files[0]);
            });
            initRutaCordovaPlugin();
        });


        const TIMEOUT_MS = 12000; // segundos de espera máxima a Firebase

        // Claves de caché dinámicas aisladas por usuario
        const CACHE = {
            get viajes() { return 'travelapp_' + getUserRoot() + '_viajes_cache'; },
            get lastViajeId() { return 'travelapp_' + getUserRoot() + '_last_viaje_id'; },
            get lastViaje() { return 'travelapp_' + getUserRoot() + '_last_viaje'; },
            get syncQueue() { return 'travelapp_' + getUserRoot() + '_syncQueue'; },
            viajeData: id => 'travelapp_' + getUserRoot() + '_viajedata_' + id,
            diasLegacy: id => 'travelapp_' + getUserRoot() + '_dias_' + id
        };

        /* ---------------- Utilidades ---------------- */
        function toFbKey(key) {
            return String(key).replace(/\$/g, '_S_').replace(/\./g, '_D_').replace(/#/g, '_H_').replace(/\//g, '_F_');
        }

        function fromFbKey(key) {
            return String(key).replace(/_S_/g, '$').replace(/_D_/g, '.').replace(/_H_/g, '#').replace(/_F_/g, '/');
        }

        function encodeObjectKeys(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
            const res = {};
            for (const k of Object.keys(obj)) {
                res[toFbKey(k)] = obj[k];
            }
            return res;
        }

        function decodeObjectKeys(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
            const res = {};
            for (const k of Object.keys(obj)) {
                res[fromFbKey(k)] = (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]))
                    ? decodeObjectKeys(obj[k])
                    : obj[k];
            }
            return res;
        }

        function getCache(key) {
            try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
            catch (e) { return null; }
        }
        function setCache(key, val) {
            try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
        }
        function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

        // Genera un id único (estilo Firebase si está disponible, sino local)
        function genId() {
            if (FIREBASE_AVAILABLE) {
                try { return db.ref().push().key; } catch (e) {}
            }
            return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        }

        // Reemplaza el marcador "TIMESTAMP" por fecha local o por timestamp del servidor
        function normalizeTimestamps(obj, mode) {
            if (Array.isArray(obj)) { obj.forEach(o => normalizeTimestamps(o, mode)); return obj; }
            if (obj && typeof obj === 'object') {
                for (const k of Object.keys(obj)) {
                    const v = obj[k];
                    if (v === "TIMESTAMP") {
                        obj[k] = (mode === 'server' && FIREBASE_AVAILABLE)
                            ? firebase.database.ServerValue.TIMESTAMP
                            : Date.now();
                    } else if (v && typeof v === 'object') {
                        normalizeTimestamps(v, mode);
                    }
                }
            }
            return obj;
        }

        // Cualquier promesa de Firebase se limita a TIMEOUT_MS
        function withTimeout(promise, ms = TIMEOUT_MS) {
            return Promise.race([
                promise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
            ]);
        }

        function getRef(path) {
            if (!currentViajeId) { toast('Error: Seleccioná un viaje'); throw new Error('No trip selected'); }
            if (!db) throw new Error('Firebase no disponible');
            return db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/${path}`);
        }

        /* ---------------- Caché por viaje (respaldo en el dispositivo) ---------------- */
        function getViajeCache(id) {
            if (!id) return { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
            let cache = getCache(CACHE.viajeData(id));
            if (!cache) {
                cache = { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
                const legacy = getCache(CACHE.diasLegacy(id)); // migrar caché antigua de días
                if (legacy) cache.dias = legacy;
            }
            return cache;
        }
        function setViajeCache(id, cache) { setCache(CACHE.viajeData(id), cache); }

        // Escribe un cambio en la caché local (write-through)
        function applyToCache(path, action, data, viajeId) {
            const cache = getViajeCache(viajeId);
            const parts = path.split('/');
            const collection = parts[0];
            const id = parts[1] || null;
            const cData = data == null ? null : normalizeTimestamps(deepClone(data), 'local');

            if (collection === 'configuracion' || collection === 'cotizaciones') {
                const bucket = cache[collection] = cache[collection] || {};
                if (action === 'remove' && id) delete bucket[id];
                else if (action === 'set' && id) bucket[id] = cData;
                else if (action === 'update' && id) bucket[id] = { ...(bucket[id] || {}), ...cData };
            } else {
                let arr = cache[collection] || [];
                if (action === 'remove' && id) {
                    arr = arr.filter(x => x.id !== id);
                } else if ((action === 'set' || action === 'update') && id) {
                    const i = arr.findIndex(x => x.id === id);
                    if (i >= 0) arr[i] = { ...arr[i], ...cData };
                    else arr.push({ id, ...cData });
                }
                cache[collection] = arr;
            }
            setViajeCache(viajeId, cache);
        }

        // Sobreescribe una colección completa (cuando se lee del servidor)
        function cacheCollection(viajeId, collection, arr) {
            const cache = getViajeCache(viajeId);
            cache[collection] = arr;
            setViajeCache(viajeId, cache);
        }

        // Mezcla la cola pendiente en una lista, para ver los cambios sin conexión
        function mergeQueued(arr, collection) {
            const out = arr.slice();
            (SyncManager.queue || []).forEach(op => {
                if (op.viajeId !== currentViajeId) return;
                const parts = op.path.split('/');
                if (parts[0] !== collection) return;
                const id = parts[1];
                if (!id) return;
                if (op.action === 'remove') {
                    const i = out.findIndex(x => x.id === id);
                    if (i >= 0) out.splice(i, 1);
                } else {
                    const d = normalizeTimestamps(deepClone(op.data), 'local');
                    const i = out.findIndex(x => x.id === id);
                    if (i >= 0) out[i] = { ...out[i], ...d };
                    else out.push({ id, ...d });
                }
            });
            return out;
        }

        /* ---------------- Cola de sincronización ---------------- */
        const SyncManager = {
            queue: getCache(CACHE.syncQueue) || [],

            loadQueue() {
                this.queue = getCache(CACHE.syncQueue) || [];
                this.updateUI();
            },

            saveQueue() {
                setCache(CACHE.syncQueue, this.queue);
                this.updateUI();
            },

            // Guarda un dato. Si hay internet lo escribe directo; si no, lo encola.
            async save(path, action, data = null, isGlobal = false) {
                const viajeId = isGlobal ? null : currentViajeId;
                let generatedId = null;
                if (action === 'push') generatedId = genId(); // id estable para caché + firebase + cola

                const sanitizedData = (data && typeof data === 'object' && !Array.isArray(data))
                    ? encodeObjectKeys(data)
                    : data;

                // 1) Write-through a la caché local (siempre hay respaldo)
                if (!isGlobal && viajeId) {
                    if (action === 'push') {
                        applyToCache(path + '/' + generatedId, 'set', sanitizedData, viajeId);
                    } else {
                        applyToCache(path, action, sanitizedData, viajeId);
                    }
                }

                // 2) Intentar escribir en Firebase si hay conexion.
                //    En modo borrador NUNCA se escribe al servidor: no hay cuenta a la
                //    que pertenezcan los datos. Todo queda local hasta que el usuario
                //    inicie sesion e importe.
                let wrote = false;
                if (FIREBASE_AVAILABLE && checkIsOnline() && !modoBorrador) {
                    try {
                        const ref = isGlobal ? db.ref(`${getUserRoot()}/${path}`) : getRef(path);
                        await withTimeout((async () => {
                            if (action === 'push') {
                                await ref.child(generatedId).set(normalizeTimestamps(deepClone(sanitizedData), 'server'));
                            } else if (action === 'update') {
                                await ref.update(normalizeTimestamps(deepClone(sanitizedData), 'server'));
                            } else if (action === 'set') {
                                await ref.set(normalizeTimestamps(deepClone(sanitizedData), 'server'));
                            } else if (action === 'remove') {
                                await ref.remove();
                            }
                        })());
                        wrote = true;
                    } catch (e) {
                        wrote = false; // sin respuesta del servidor → encolar
                    }
                }

                // 3) Si no se pudo escribir online, encolar
                if (!wrote) {
                    const op = {
                        id: Date.now(),
                        path: action === 'push' ? path + '/' + (generatedId || genId()) : path,
                        action: action === 'push' ? 'set' : action,
                        data: sanitizedData == null ? null : deepClone(sanitizedData),
                        isGlobal,
                        viajeId
                    };
                    this.queue.push(op);
                    this.saveQueue();
                    if (modoBorrador) toast('Guardado en este dispositivo (modo borrador) 🧾');
                    else if (checkIsOnline()) toast('⚠️ Sin respuesta del servidor. Guardado localmente (se sincronizará).');
                    else toast('Guardado localmente (Modo Offline) 📴');
                } else {
                    this.updateUI();
                }

                return generatedId;
            },

            updateUI() {
                const pendingRoutes = typeof contarRutasPendientes === 'function' ? contarRutasPendientes() : 0;
                const pendingTotal = this.queue.length + pendingRoutes;
                const btn = document.getElementById('btn-sync');
                const banner = document.getElementById('banner-offline');
                if (btn) {
                    // Botón "solo ícono": el estado se comunica con el ícono, el color
                    // y el contador superpuesto; el nombre va en title / aria-label.
                    btn.classList.remove('bg-gray-600', 'bg-red-600', 'animate-pulse');
                    if (modoBorrador) {
                        btn.classList.remove('hidden');
                        btn.classList.add('bg-gray-600');
                        btn.innerHTML = `🧾${iconBadge(pendingTotal)}`;
                        btn.dataset.label = pendingTotal ? `Modo borrador (${pendingTotal} sin guardar)` : 'Modo borrador local';
                    } else if (pendingTotal > 0) {
                        btn.classList.remove('hidden');
                        btn.classList.add('bg-red-600', 'animate-pulse');
                        btn.innerHTML = `🔄${iconBadge(pendingTotal)}`;
                        btn.dataset.label = `Sincronizar (${pendingTotal} pendiente${pendingTotal === 1 ? '' : 's'})`;
                    } else if (!checkIsOnline() || !FIREBASE_AVAILABLE) {
                        btn.classList.remove('hidden', 'animate-pulse');
                        btn.classList.add('bg-gray-600');
                        btn.innerHTML = `📵`;
                        btn.dataset.label = 'Sin conexión (offline)';
                    } else {
                        btn.classList.add('hidden');
                        btn.classList.remove('animate-pulse');
                        btn.innerHTML = `🔄`;
                        btn.dataset.label = 'Sincronizar';
                    }
                    btn.title = btn.dataset.label;
                    btn.setAttribute('aria-label', btn.dataset.label);
                }
                if (banner) banner.classList.toggle('hidden', checkIsOnline() || modoBorrador);

                // Banner de modo borrador local
                const draftBanner = document.getElementById('banner-borrador');
                if (draftBanner) draftBanner.classList.toggle('hidden', !modoBorrador);

                const btnUpload = document.getElementById('btn-upload');
                if (btnUpload) {
                    if (modoBorrador) {
                        // En modo borrador no se suben fotos: la cuenta de Cloudinary es
                        // central y una foto de un borrador descartado quedaria huerfana
                        // ocupando cuota. Se habilita al iniciar sesion.
                        btnUpload.disabled = true;
                        btnUpload.classList.add('opacity-50', 'cursor-not-allowed');
                        btnUpload.textContent = '📷 Fotos (requiere cuenta)';
                    } else if (checkIsOnline()) {
                        btnUpload.disabled = false;
                        btnUpload.classList.remove('opacity-50', 'cursor-not-allowed');
                        btnUpload.textContent = '📷 Subir fotos a Cloudinary';
                    } else {
                        btnUpload.disabled = true;
                        btnUpload.classList.add('opacity-50', 'cursor-not-allowed');
                        btnUpload.textContent = '📷 Fotos (Requiere Internet)';
                    }
                }
            },

            async sync(auto = false) {
                if (modoBorrador) {
                    // En modo borrador no hay cuenta destino: no se sincroniza.
                    if (!auto) toast('🧾 Estás en modo borrador local. Iniciá sesión para guardar en la nube e importar estos datos.');
                    return;
                }
                if (!FIREBASE_AVAILABLE) { if (!auto) toast('Firebase no disponible. Reconectate y recargá la app para sincronizar.'); return; }
                if (!checkIsOnline()) { if (!auto) toast('No hay conexión a internet.'); return; }
                const rutasPendientes = typeof contarRutasPendientes === 'function' ? contarRutasPendientes() : 0;
                if (this.queue.length === 0 && rutasPendientes === 0) { if (!auto) toast('No hay elementos pendientes.'); return; }

                if (!auto) toast('Sincronizando...');
                const btn = document.getElementById('btn-sync');
                if (btn) { btn.innerHTML = `⏳`; btn.dataset.label = 'Sincronizando…'; }

                try {
                    for (let i = 0; i < this.queue.length; i++) {
                        const op = this.queue[i];
                        let ref = op.isGlobal ? db.ref(`${getUserRoot()}/${op.path}`) : db.ref(`${getUserRoot()}/viajes_data/${op.viajeId}/${op.path}`);
                        const payload = (op.data && typeof op.data === 'object' && !Array.isArray(op.data))
                            ? encodeObjectKeys(op.data)
                            : op.data;

                        if (op.action === 'set') await ref.set(normalizeTimestamps(deepClone(payload), 'server'));
                        else if (op.action === 'update') await ref.update(normalizeTimestamps(deepClone(payload), 'server'));
                        else if (op.action === 'remove') await ref.remove();
                    }
                    this.queue = [];
                    this.saveQueue();
                    if (typeof syncRutasLocales === 'function') await syncRutasLocales();
                    if (!auto) toast('✅ Sincronización completa');
                    await initAdminGlobal();
                } catch (e) {
                    console.error(e);
                    if (!auto) toast('❌ Error al sincronizar: ' + (e.message || e));
                    this.updateUI();
                }
            }
        };

        if (FIREBASE_AVAILABLE && db) {
            try {
                db.ref('.info/connected').on('value', snap => {
                    isFirebaseConnected = !!snap.val();
                    SyncManager.updateUI();
                    if (isFirebaseConnected && (SyncManager.queue.length > 0 || contarRutasPendientes() > 0)) {
                        SyncManager.sync(true);
                    }
                });
            } catch (e) {}
        }

        window.addEventListener('online', () => { actualizarAvisoOffline(); SyncManager.updateUI(); SyncManager.sync(true); });
        window.addEventListener('offline', () => { actualizarAvisoOffline(); SyncManager.updateUI(); });

        /* ---------------- Carga inicial / selector de viajes ---------------- */
        async function initAdminGlobal() {
            SyncManager.updateUI();
            const selector = document.getElementById('select-viaje');
            let viajes = [];
            let viaSource = 'online';

            // 1) Intentar leer de Firebase con timeout
            if (FIREBASE_AVAILABLE && checkIsOnline()) {
                try {
                    const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_index`).once('value'));
                    if (snap.exists()) {
                        snap.forEach(c => { viajes.push({ ...c.val(), id: c.key }); });
                        viajes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                        setCache(CACHE.viajes, viajes);
                    }
                } catch (e) {
                    viaSource = 'cache';
                    viajes = getCache(CACHE.viajes) || [];
                }
            } else {
                viaSource = 'cache';
                viajes = getCache(CACHE.viajes) || [];
            }

            // 2) Último recurso: el último viaje recordado
            if (viajes.length === 0) {
                const last = getCache(CACHE.lastViaje);
                if (last) viajes = [last];
            }

            // 3) Pintar selector y elegir viaje
            if (viajes.length > 0) {
                selector.innerHTML = viajes.map(v =>
                    `<option value="${escapeHtml(v.id)}">${escapeHtml(v.titulo)} ${v.activo ? '✅' : '⛔'}${viaSource === 'cache' ? ' (offline)' : ''}</option>`
                ).join('');

                const savedId = getCache(CACHE.lastViajeId);
                if (!currentViajeId || !viajes.find(v => v.id === currentViajeId)) {
                    currentViajeId = (savedId && viajes.find(v => v.id === savedId))
                        ? savedId
                        : ((viajes.find(v => v.activo) || viajes[0])?.id || null);
                }
                selector.value = currentViajeId;
                setCache(CACHE.lastViajeId, currentViajeId);
                const sel = viajes.find(v => v.id === currentViajeId);
                if (sel) setCache(CACHE.lastViaje, sel);
                actualizarBadgeEstado(viajes);
                updateNavigationLinks();
            } else {
                selector.innerHTML = '<option value="">(No hay viajes)</option>';
                currentViajeId = null;
                updateNavigationLinks();
                document.getElementById('lista-entradas').innerHTML =
                    '<p class="text-amber-600 py-4">⚠️ No hay viajes disponibles. Conectate una vez para descargar los datos, o creá un viaje nuevo con el botón ➕ NUEVO VIAJE.</p>';
            }

            if (currentViajeId) {
                const activeTabBtn = document.querySelector('.tab-btn.active');
                if (activeTabBtn) switchTab('tab-' + activeTabBtn.id.split('-')[1]);
            }
        }

        function actualizarBadgeEstado(viajes) {
            const viajeActual = viajes.find(v => v.id === currentViajeId);
            if (!viajeActual) return;
            const titulo = document.getElementById('estado-viaje-titulo');
            const badge = document.getElementById('estado-viaje-badge');
            const btnToggle = document.getElementById('btn-toggle-viaje');
            if (titulo) titulo.textContent = viajeActual.titulo;
            if (badge) {
                badge.textContent = viajeActual.activo ? 'Activo ✅' : 'Finalizado ⛔';
                badge.className = `font-bold ${viajeActual.activo ? 'text-emerald-600' : 'text-red-500'}`;
            }
            if (btnToggle) {
                btnToggle.textContent = viajeActual.activo ? 'Finalizar Viaje ⛔' : 'Reactivar Viaje ✅';
                btnToggle.className = viajeActual.activo
                    ? 'px-5 py-2 rounded-lg text-sm font-bold bg-red-100 text-red-700 hover:bg-red-200 transition'
                    : 'px-5 py-2 rounded-lg text-sm font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition';
            }
        }

        function updateViajesCache(viajeId, changes) {
            let viajes = getCache(CACHE.viajes) || [];
            const i = viajes.findIndex(v => v.id === viajeId);
            if (i >= 0) viajes[i] = { ...viajes[i], ...changes };
            else viajes.push({ id: viajeId, ...changes });
            setCache(CACHE.viajes, viajes);
            const last = getCache(CACHE.lastViaje);
            if (last && last.id === viajeId) setCache(CACHE.lastViaje, { ...last, ...changes });
        }

        async function toggleEstadoViaje() {
            if (!currentViajeId) return;
            const viajes = getCache(CACHE.viajes) || [];
            const actual = viajes.find(v => v.id === currentViajeId);
            if (!actual) return toast('No se encontró el viaje');
            const activo = !!actual.activo;
            const accion = activo ? 'finalizar' : 'reactivar';
            if (!confirm(`¿Querés ${accion} este viaje?`)) return;

            // Online
            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_index/` + currentViajeId).once('value'));
                    const activoServer = snap.exists() ? snap.val().activo : activo;
                    if (!activoServer) {
                        const todos = await withTimeout(db.ref(`${getUserRoot()}/viajes_index`).once('value'));
                        todos.forEach(c => { if (c.val().activo) SyncManager.save('viajes_index/' + c.key, 'update', { activo: false }, true); });
                    }
                    await SyncManager.save('viajes_index/' + currentViajeId, 'update', { activo: !activoServer }, true);
                    updateViajesCache(currentViajeId, { activo: !activoServer });
                    toast(activoServer ? 'Viaje finalizado ⛔' : 'Viaje reactivado ✅');
                    await initAdminGlobal();
                    return;
                } catch (e) { /* cae al modo offline */ }
            }

            // Offline: encolar y actualizar caché local
            SyncManager.save('viajes_index/' + currentViajeId, 'update', { activo: !activo }, true);
            updateViajesCache(currentViajeId, { activo: !activo });
            toast(activo ? 'Viaje finalizado ⛔ (offline)' : 'Viaje reactivado ✅ (offline)');
            await initAdminGlobal();
        }

        async function nuevoViaje() {
            const titulo = prompt("Título del viaje (ej: Sur 2024):");
            if (!titulo) return;
            const data = { titulo: titulo, activo: true, createdAt: "TIMESTAMP" };

            // Online
            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_index`).once('value'));
                    if (snap.exists()) {
                        snap.forEach(c => { if (c.val().activo) SyncManager.save('viajes_index/' + c.key, 'update', { activo: false }, true); });
                    }
                    const id = await SyncManager.save('viajes_index', 'push', data, true);
                    if (id) {
                        updateViajesCache(id, { id, ...normalizeTimestamps(deepClone(data), 'local') });
                        currentViajeId = id;
                        setCache(CACHE.lastViajeId, id);
                        setCache(CACHE.lastViaje, { id, titulo, activo: true });
                        updateNavigationLinks();
                        toast('Viaje creado');
                        await initAdminGlobal();
                        return;
                    }
                } catch (e) { /* cae al modo offline */ }
            }

            // Offline: crear viaje local y encolar para cuando haya internet
            const id = genId();
            updateViajesCache(id, { id, ...normalizeTimestamps(deepClone(data), 'local') });
            SyncManager.queue.push({ id: Date.now(), path: 'viajes_index/' + id, action: 'set', data: data, isGlobal: true, viajeId: null });
            SyncManager.saveQueue();
            currentViajeId = id;
            setCache(CACHE.lastViajeId, id);
            setCache(CACHE.lastViaje, { id, titulo, activo: true });
            toast('Viaje creado (offline) 📴 — se sincronizará al conectar');
            await initAdminGlobal();
        }

        function cambiarViaje(id) {
            const ctx = typeof getRutaActivaContexto === 'function' ? getRutaActivaContexto() : null;
            if (ctx && ctx.viajeId && ctx.viajeId !== id) {
                toast('⏹ Finalizá el seguimiento GPS antes de cambiar de viaje.');
                const selector = document.getElementById('select-viaje');
                if (selector) selector.value = currentViajeId || '';
                return;
            }
            currentViajeId = id;
            initAdminGlobal();
        }

        let fotosUrls = [];

        // ESTADO ESTRICTO EN MEMORIA
        let currentEditId = null;

        function switchTab(id) {
            ['tab-nueva','tab-entradas','tab-comentarios','tab-ruta','tab-finanzas'].forEach(tab => {
                document.getElementById(tab).classList.toggle('hidden', tab !== id);
                document.getElementById('btn-' + tab.split('-')[1]).classList.toggle('active', tab === id);
                document.getElementById('btn-' + tab.split('-')[1]).classList.toggle('bg-white', tab !== id);
            });
            if (id === 'tab-entradas') cargarEntradas();
            if (id === 'tab-comentarios') cargarComentarios();
            if (id === 'tab-ruta') initRutasUI();
            if (id === 'tab-finanzas') initFinanzas();
        }

        /* ---- Subida a Cloudinary con compresión previa en el navegador ----
           La imagen se reescala (lado largo <= FOTO_MAX_DIM) y se re-encodea a JPEG
           antes de subirla. Así el almacenamiento que ocupa cada foto baja de varios
           MB a ~200-400 KB y el plan gratuito de Cloudinary rinde muchísimo más. */
        const FOTO_MAX_DIM = 1920;        // lado largo máximo tras comprimir
        const FOTO_JPEG_QUALITY = 0.82;   // calidad JPEG

        let subiendoFotos = false;

        // Inserta parámetros de transformación en una URL de Cloudinary (si lo es).
        function cldUrl(url, params) {
            if (!url || typeof url !== 'string') return url;
            const seg = '/image/upload/';
            const idx = url.indexOf(seg);
            if (idx === -1) return url;
            return url.slice(0, idx + seg.length) + params + '/' + url.slice(idx + seg.length);
        }

        function initCloudinaryWidget() {
            const btn = document.getElementById('btn-upload');
            const input = document.getElementById('foto-file-input');
            if (!btn || !input) return;
            btn.addEventListener('click', ev => {
                ev.preventDefault();
                if (modoBorrador) {
                    toast('🧾 En modo borrador no se pueden subir fotos. Iniciá sesión para guardarlas en tu cuenta.');
                    return;
                }
                if (subiendoFotos) { toast('Subiendo fotos, esperá…'); return; }
                input.value = '';
                input.click();
            });
            input.addEventListener('change', () => {
                if (input.files && input.files.length) {
                    procesarFotosSeleccionadas(Array.from(input.files));
                }
            });
        }

        function leerComoDataURL(file) {
            return new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => reject(fr.error || new Error('No se pudo leer la imagen'));
                fr.readAsDataURL(file);
            });
        }

        function cargarImagen(src) {
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
        }

        function canvasToBlob(canvas, type, quality) {
            return new Promise(resolve => canvas.toBlob(resolve, type, quality));
        }

        async function comprimirImagen(file) {
            // Devuelve un Blob JPEG comprimido o el archivo original si no se pudo
            // procesar (ej. HEIC) o si ya es un JPEG que no amerita re-encode.
            if (!file || !/^image\//.test(file.type)) return file;
            try {
                const img = await cargarImagen(await leerComoDataURL(file));
                if (!img || !img.naturalWidth) return file;
                const scale = Math.min(1, FOTO_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                if (w === img.naturalWidth && h === img.naturalHeight && file.type === 'image/jpeg') {
                    return file; // ya es JPEG y no hay que reescalar: evitar doble compresión
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff'; // fondo blanco para PNG con transparencia
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                const blob = await canvasToBlob(canvas, 'image/jpeg', FOTO_JPEG_QUALITY);
                if (!blob || blob.size >= file.size) return file;
                return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
            } catch (e) {
                console.warn('No se pudo comprimir', file && file.name, e);
                return file;
            }
        }

        function subirACloudinary(blob) {
            return new Promise((resolve, reject) => {
                const fd = new FormData();
                fd.append('file', blob);
                fd.append('cloud_name', CLOUDINARY_CLOUD_NAME);
                fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload');
                xhr.onload = () => {
                    let res = null;
                    try { res = JSON.parse(xhr.responseText); } catch (e) {}
                    if (xhr.status >= 200 && xhr.status < 300 && res && res.secure_url) resolve(res);
                    else reject(new Error((res && res.error && res.error.message) || 'Error al subir a Cloudinary (código ' + xhr.status + ')'));
                };
                xhr.onerror = () => reject(new Error('Error de red al subir a Cloudinary'));
                xhr.send(fd);
            });
        }

        async function procesarFotosSeleccionadas(files) {
            if (subiendoFotos) return;
            subiendoFotos = true;
            const btn = document.getElementById('btn-upload');
            const statusEl = document.getElementById('upload-status');
            if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-wait'); }
            if (statusEl) statusEl.classList.remove('hidden');

            let ok = 0, errores = 0;
            for (let i = 0; i < files.length; i++) {
                if (statusEl) statusEl.textContent = '⏳ Subiendo foto ' + (i + 1) + ' de ' + files.length + '…';
                try {
                    const archivo = await comprimirImagen(files[i]);
                    const res = await subirACloudinary(archivo);
                    fotosUrls.push({ url: res.secure_url, descripcion: '' });
                    ok++;
                } catch (e) {
                    console.error('Fallo al subir', files[i] && files[i].name, e);
                    errores++;
                }
            }

            renderFotosPreview();
            if (statusEl) { statusEl.textContent = ''; statusEl.classList.add('hidden'); }
            if (btn) { btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-wait'); }
            subiendoFotos = false;
            if (errores === 0) toast('¡' + ok + ' foto' + (ok === 1 ? '' : 's') + ' subida' + (ok === 1 ? '' : 's') + '!');
            else toast('Subidas: ' + ok + '. Fallaron: ' + errores + '.');
        }

        function renderFotosPreview() {
            const container = document.getElementById('fotos-preview');
            container.innerHTML = fotosUrls.map((f, i) => {
                const url = typeof f === 'string' ? f : f.url;
                const desc = typeof f === 'string' ? '' : (f.descripcion || '');
                return `
                <div class="foto-preview relative border rounded p-1 bg-gray-50 flex flex-col gap-1 w-32">
                    <img src="${escapeHtml(cldUrl(url, 'w_320,f_auto,q_auto'))}" class="w-full h-20 object-cover rounded">
                    <input type="text" placeholder="Descripción..." value="${escapeHtml(desc)}" onchange="updateFotoDesc(${i}, this.value)" class="text-xs w-full p-1 border rounded">
                    <button onclick="fotosUrls.splice(${i},1);renderFotosPreview()" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:bg-red-600">&times;</button>
                </div>`;
            }).join('');
        }

        function updateFotoDesc(index, val) {
            if (typeof fotosUrls[index] === 'string') {
                fotosUrls[index] = { url: fotosUrls[index], descripcion: val };
            } else {
                fotosUrls[index].descripcion = val;
            }
        }

        function resetForm() {
            document.querySelectorAll('#tab-nueva input, #tab-nueva textarea').forEach(e => e.value = '');
            currentEditId = null; // LIMPIEZA ABSOLUTA DEL ID
            fotosUrls = [];
            renderFotosPreview();
            document.getElementById('form-titulo').textContent = 'Nueva entrada de día';
        }

        /* ---------------- DÍAS (relato del día) ---------------- */
        async function guardarDia() {
            const data = {
                numero: parseInt(document.getElementById('f-numero').value),
                fecha: new Date(document.getElementById('f-fecha').value + 'T12:00:00').getTime(),
                destino: document.getElementById('f-destino').value,
                titulo: document.getElementById('f-titulo').value,
                recorrido: document.getElementById('f-recorrido').value,
                contenido: document.getElementById('f-contenido').value,
                fotos: fotosUrls
            };

            if (!data.numero || !data.fecha || !data.destino) return toast('Faltan datos obligatorios');

            try {
                if (currentEditId) {
                    await SyncManager.save('dias/' + currentEditId, 'update', data);
                    toast('✅ Entrada guardada');
                } else {
                    data.createdAt = "TIMESTAMP";
                    await SyncManager.save('dias', 'push', data);
                    toast('✅ Nuevo día guardado');
                }
                resetForm();
                cargarEntradas(); // Refrescar lista automáticamente
            } catch (err) {
                toast('❌ Error: ' + err.message);
            }
        }

        async function cargarEntradas() {
            let arr = [];
            const cache = getViajeCache(currentViajeId);

            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(getRef('dias').once('value'));
                    snap.forEach(c => { arr.push({ ...c.val(), id: c.key }); });
                    cacheCollection(currentViajeId, 'dias', arr);
                } catch (e) {
                    arr = cache.dias || [];
                }
            } else {
                arr = cache.dias || [];
            }

            arr = mergeQueued(arr, 'dias');
            arr.sort((a, b) => (a.numero || 0) - (b.numero || 0));

            const html = arr.map(d => `<div class="flex justify-between items-center py-3 border-b"><span class="font-bold text-gray-800">Día ${escapeHtml(d.numero)} - ${escapeHtml(d.destino)}</span> <div><button onclick="editarDia('${escapeHtml(d.id)}')" class="text-blue-600 bg-blue-50 px-3 py-1 rounded-md text-sm font-bold mr-2 hover:bg-blue-100 transition">Editar</button><button onclick="eliminarDia('${escapeHtml(d.id)}')" class="text-red-600 bg-red-50 px-3 py-1 rounded-md text-sm font-bold hover:bg-red-100 transition">Borrar</button></div></div>`).join('');
            document.getElementById('lista-entradas').innerHTML = html || '<p class="text-gray-400 italic py-4">No hay días registrados.</p>';
        }

        async function editarDia(id) {
            let d = null;
            const cache = getViajeCache(currentViajeId);

            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(getRef('dias/' + id).once('value'));
                    if (snap.exists()) { d = snap.val(); d.id = id; }
                } catch (e) { /* usa caché */ }
            }
            if (!d) {
                d = (cache.dias || []).find(x => x.id === id);
            }
            if (!d) {
                d = mergeQueued([], 'dias').find(x => x.id === id);
            }
            if (!d) return toast('📴 No se pudo cargar el día (sin conexión ni caché).');

            currentEditId = id;
            document.getElementById('f-numero').value = d.numero;
            document.getElementById('f-fecha').value = new Date(d.fecha).toISOString().split('T')[0];
            document.getElementById('f-destino').value = d.destino;
            document.getElementById('f-titulo').value = d.titulo || '';
            document.getElementById('f-recorrido').value = d.recorrido || '';
            document.getElementById('f-contenido').value = d.contenido;
            fotosUrls = d.fotos || []; renderFotosPreview();

            document.getElementById('form-titulo').innerHTML = `✏️ Editando Día ${escapeHtml(d.numero)} <button onclick="resetForm()" class="ml-4 text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-full shadow-sm hover:bg-red-200 transition">Cancelar edición (Crear nuevo)</button>`;
            switchTab('tab-nueva');
        }

        async function eliminarDia(id) {
            if (!confirm('¿Seguro que querés borrar este día entero?\n\nTambién se eliminará su ruta GPS, si tiene una registrada.')) return;

            // 1) Conocer la fecha del día: es la clave bajo la que se guarda su ruta.
            let d = null;
            const cache = getViajeCache(currentViajeId);
            if (FIREBASE_AVAILABLE && navigator.onLine && !modoBorrador) {
                try {
                    const snap = await withTimeout(getRef('dias/' + id).once('value'));
                    if (snap.exists()) d = snap.val();
                } catch (e) { /* se usa la caché */ }
            }
            if (!d) d = (cache.dias || []).find(x => x.id === id);
            if (!d && typeof mergeQueued === 'function') d = mergeQueued([], 'dias').find(x => x.id === id);

            // 2) Eliminar el día (caché + Firebase, o cola si está offline)
            await SyncManager.save('dias/' + id, 'remove');

            // 3) Eliminar también su ruta GPS: servidor/cola + caché local de rutas,
            //    para que no reaparezca al sincronizar.
            let rutaEliminada = false;
            if (d && d.fecha) {
                const fechaRuta = (typeof d.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha))
                    ? d.fecha
                    : fechaRutaDeTimestamp(d.fecha);
                if (fechaRuta) {
                    try {
                        await SyncManager.save('rutas/' + fechaRuta, 'remove');
                        rutaEliminada = true;
                    } catch (e) {
                        console.warn('No se pudo eliminar la ruta del día:', e);
                    }
                    try { localStorage.removeItem(rutaLocalKey(getUserRoot(), currentViajeId, fechaRuta)); } catch (e) {}
                }
            }

            cargarEntradas();
            if (typeof cargarRutaDelDia === 'function') { try { cargarRutaDelDia(); } catch (e) {} }
            toast(rutaEliminada ? '🗑️ Día y ruta GPS eliminados.' : '🗑️ Día eliminado.');
        }

        /* ---------------- COMENTARIOS ---------------- */
        let filtroComentarios = 'pendientes';
        async function cargarComentarios(f) {
            if (f) filtroComentarios = f;
            let todos = [];

            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(getRef('comentarios').once('value'));
                    snap.forEach(c => { todos.push({ ...c.val(), id: c.key }); });
                    cacheCollection(currentViajeId, 'comentarios', todos);
                } catch (e) {
                    todos = getViajeCache(currentViajeId).comentarios || [];
                }
            } else {
                todos = getViajeCache(currentViajeId).comentarios || [];
            }

            todos = mergeQueued(todos, 'comentarios');
            todos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            let html = ''; let countPendientes = 0;
            todos.forEach(c => {
                if (!c.aprobado) countPendientes++;
                if ((filtroComentarios === 'pendientes' && !c.aprobado) || (filtroComentarios === 'aprobados' && c.aprobado)) {
                    html += `<div class="p-3 border rounded mb-2 ${c.aprobado ? 'bg-green-50' : 'bg-red-50'}">${escapeHtml(c.autor)}: ${escapeHtml(c.texto)} <br>` +
                        (!c.aprobado ? `<button onclick="aprobarComentario('${escapeHtml(c.id)}')" class="text-green-600 font-bold mt-1">Aprobar</button>` :
                        `<button onclick="ocultarComentario('${escapeHtml(c.id)}')" class="text-orange-600 font-bold mt-1 mr-3">Ocultar</button>`) +
                        `<button onclick="borrarComentario('${escapeHtml(c.id)}')" class="text-red-600 font-bold mt-1 ml-3">Borrar</button></div>`;
                }
            });
            document.getElementById('lista-comentarios').innerHTML = html || '<p>No hay comentarios</p>';
            const badge = document.getElementById('badge-pendientes');
            badge.textContent = countPendientes; badge.classList.toggle('hidden', countPendientes === 0);
        }
        function filtrarComentarios(f) { cargarComentarios(f); }

        async function aprobarComentario(id) { await SyncManager.save('comentarios/' + id, 'update', { aprobado: true }); toast('Aprobado'); cargarComentarios(); }
        async function apobarComentario(id){ return aprobarComentario(id); } // alias compatibilidad typo previo
        async function ocultarComentario(id) { await SyncManager.save('comentarios/' + id, 'update', { aprobado: false }); toast('Oculto'); cargarComentarios(); }
        async function borrarComentario(id) { await SyncManager.save('comentarios/' + id, 'remove'); cargarComentarios(); }

        async function actualizarBadgeComentarios() {
            if (!currentViajeId) return;
            let todos = getViajeCache(currentViajeId).comentarios || [];
            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(getRef('comentarios').once('value'));
                    todos = [];
                    snap.forEach(c => { todos.push({ ...c.val(), id: c.key }); });
                    cacheCollection(currentViajeId, 'comentarios', todos);
                } catch (e) {}
            }
            let p = 0; todos.forEach(c => { if (!c.aprobado) p++; });
            const badge = document.getElementById('badge-pendientes');
            badge.textContent = p;
            badge.classList.toggle('hidden', p === 0);
        }

        /* ---------------- FINANZAS Y GASTOS ---------------- */
        let viajerosList = [];
        let monedaOrigen = 'UY$';
        let monedasGastoList = ['AR$', 'US$', 'UY$'];
        let cotizacionesEfectivoMemoria = {};
        let cotizacionesTarjetaMemoria = {};
        let esMontoUSManual = false;

        function abrirModalConfigViaje() {
            if (!currentViajeId) {
                toast('Error: Seleccioná o creá un viaje primero');
                return;
            }
            const modal = document.getElementById('modal-config-viaje');
            if (!modal) return;

            const cache = getViajeCache(currentViajeId);
            const cfg = cache.configuracion || {};

            // Actualizar estado del viaje
            const viajes = getCache(CACHE.viajes) || [];
            actualizarBadgeEstado(viajes);

            // Viajeros
            let v = (viajerosList && viajerosList.length > 0) ? viajerosList : cfg.viajeros;
            if (v && typeof v === 'object' && !Array.isArray(v)) v = Object.values(v);
            if (Array.isArray(v) && v.length > 0) {
                viajerosList = v;
                document.getElementById('c-viajeros').value = v.join(', ');
            } else {
                document.getElementById('c-viajeros').value = '';
            }

            // Monedas
            const orig = monedaOrigen || cfg.moneda_origen || 'UY$';
            let mList = (monedasGastoList && monedasGastoList.length > 0) ? monedasGastoList : (cfg.monedas_gasto || ['AR$', 'US$', 'UY$']);
            if (mList && typeof mList === 'object' && !Array.isArray(mList)) mList = Object.values(mList);
            monedaOrigen = orig;
            monedasGastoList = Array.isArray(mList) ? mList : String(mList).split(',').map(s => s.trim()).filter(Boolean);
            document.getElementById('c-moneda-origen').value = monedaOrigen;
            document.getElementById('c-monedas-gasto').value = monedasGastoList.join(', ');

            // Presupuesto estimado
            const pres = cfg.presupuesto_estimado || {};
            document.getElementById('p-combustible').value = pres.Combustible != null ? pres.Combustible : '';
            document.getElementById('p-hoteleria').value = pres.Hoteleria != null ? pres.Hoteleria : '';
            document.getElementById('p-excursiones').value = pres.Excursiones != null ? pres.Excursiones : '';
            document.getElementById('p-alimentacion').value = pres.Alimentacion != null ? pres.Alimentacion : '';
            document.getElementById('p-otros').value = pres.Otros != null ? pres.Otros : '';

            modal.classList.remove('hidden');
        }

        async function initFinanzas() {
            if (!currentViajeId) return;
            const hoy = new Date().toISOString().split('T')[0];
            if (!document.getElementById('c-tarjeta-fecha').value) document.getElementById('c-tarjeta-fecha').value = hoy;
            if (!document.getElementById('g-fecha').value) document.getElementById('g-fecha').value = hoy;

            const cache = getViajeCache(currentViajeId);
            let cfg = cache.configuracion || {};

            // Cargar toda la configuración en una sola llamada si estamos online
            if (FIREBASE_AVAILABLE && checkIsOnline()) {
                try {
                    const snap = await withTimeout(getRef('configuracion').once('value'), 6000);
                    if (snap.exists()) {
                        const val = snap.val() || {};
                        cfg = { ...cfg, ...val };
                        cache.configuracion = cfg;
                        setViajeCache(currentViajeId, cache);
                    }
                } catch (e) {
                    console.warn('No se pudo descargar configuración de Firebase:', e);
                }
            }

            // 1. Monedas
            let orig = cfg.moneda_origen || 'UY$';
            let mList = cfg.monedas_gasto || ['AR$', 'US$', 'UY$'];
            if (mList && typeof mList === 'object' && !Array.isArray(mList)) {
                mList = Object.values(mList);
            }
            monedaOrigen = orig;
            monedasGastoList = Array.isArray(mList) ? mList : String(mList).split(',').map(s => s.trim()).filter(Boolean);
            document.getElementById('c-moneda-origen').value = monedaOrigen;
            document.getElementById('c-monedas-gasto').value = monedasGastoList.join(', ');
            actualizarSelectoresMonedas();

            // 2. Viajeros
            let viajeros = cfg.viajeros || null;
            if (viajeros && typeof viajeros === 'object' && !Array.isArray(viajeros)) {
                viajeros = Object.values(viajeros);
            }
            if (viajeros && Array.isArray(viajeros) && viajeros.length > 0) {
                viajerosList = viajeros;
                document.getElementById('c-viajeros').value = viajerosList.join(', ');
                actualizarUiViajeros();
            }

            // 3. Presupuesto estimado
            let presupuesto = cfg.presupuesto_estimado || null;
            if (presupuesto) {
                document.getElementById('p-combustible').value = presupuesto.Combustible != null ? presupuesto.Combustible : '';
                document.getElementById('p-hoteleria').value = presupuesto.Hoteleria != null ? presupuesto.Hoteleria : '';
                document.getElementById('p-excursiones').value = presupuesto.Excursiones != null ? presupuesto.Excursiones : '';
                document.getElementById('p-alimentacion').value = presupuesto.Alimentacion != null ? presupuesto.Alimentacion : '';
                document.getElementById('p-otros').value = presupuesto.Otros != null ? presupuesto.Otros : '';
            }

            // 4. Tasas efectivo
            let efectivo = cfg.efectivo || null;
            if (efectivo) cotizacionesEfectivoMemoria = efectivo;
            cargarCotizacionEfectivoActual();

            // 5. Cotizaciones tarjeta
            await cargarCotizacionDiaria(document.getElementById('c-tarjeta-fecha').value);

            cargarUltimosGastos();
        }

        function actualizarSelectoresMonedas() {
            // Select de monedas en formulario de gasto
            const gMonedaSelect = document.getElementById('g-moneda');
            const valPrevG = gMonedaSelect.value;
            gMonedaSelect.innerHTML = monedasGastoList.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            if (monedasGastoList.includes(valPrevG)) gMonedaSelect.value = valPrevG;

            // Select de monedas en cotizaciones efectivo (excluyendo US$)
            const efMonedaSelect = document.getElementById('c-efectivo-moneda');
            const valPrevEf = efMonedaSelect.value;
            const monedasCotizables = monedasGastoList.filter(m => m !== 'US$' && m !== monedaOrigen);
            if (monedasCotizables.length === 0) monedasCotizables.push(monedasGastoList[0] || 'AR$');
            efMonedaSelect.innerHTML = monedasCotizables.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            if (monedasCotizables.includes(valPrevEf)) efMonedaSelect.value = valPrevEf;

            // Select de monedas en cotizaciones tarjeta
            const tjMonedaSelect = document.getElementById('c-tarjeta-moneda');
            const valPrevTj = tjMonedaSelect.value;
            tjMonedaSelect.innerHTML = monedasCotizables.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            if (monedasCotizables.includes(valPrevTj)) tjMonedaSelect.value = valPrevTj;

            // Update labels
            document.getElementById('lbl-efectivo-origen').textContent = monedaOrigen;
            document.getElementById('lbl-tarjeta-origen').textContent = monedaOrigen;
            const thOrigen = document.getElementById('th-moneda-origen');
            if (thOrigen) thOrigen.textContent = `Monto (${monedaOrigen})`;

            cargarCotizacionEfectivoActual();
            cargarCotizacionTarjetaActual();
            calcularMontoUSAuto();
        }

        async function guardarConfigMonedas() {
            const origenInput = document.getElementById('c-moneda-origen').value.trim();
            const gastoInput = document.getElementById('c-monedas-gasto').value;
            if (!origenInput) return toast('Ingresá la moneda de origen');
            const lista = gastoInput.split(',').map(v => v.trim()).filter(Boolean);
            if (lista.length === 0) return toast('Ingresá al menos una moneda de gasto');
            if (!lista.includes('US$')) lista.push('US$');
            if (!lista.includes(origenInput)) lista.push(origenInput);

            monedaOrigen = origenInput;
            monedasGastoList = lista;

            await SyncManager.save('configuracion/moneda_origen', 'set', monedaOrigen);
            await SyncManager.save('configuracion/monedas_gasto', 'set', monedasGastoList);

            actualizarSelectoresMonedas();
            toast('Monedas guardadas');
        }

        function cargarCotizacionEfectivoActual() {
            const mSelect = document.getElementById('c-efectivo-moneda').value;
            document.getElementById('lbl-efectivo-moneda').textContent = mSelect;
            document.getElementById('lbl-efectivo-origen').textContent = monedaOrigen;

            const ef = decodeObjectKeys(cotizacionesEfectivoMemoria);
            const tasaUs = ef[mSelect] || (mSelect === 'AR$' ? ef.ar_por_us : '') || '';
            const tasaOrigen = ef[monedaOrigen] || (monedaOrigen === 'UY$' ? ef.uy_por_us : '') || '';

            document.getElementById('c-efectivo-us').value = tasaUs;
            document.getElementById('c-efectivo-origen-us').value = tasaOrigen;
        }

        function cargarCotizacionTarjetaActual() {
            const mSelect = document.getElementById('c-tarjeta-moneda').value;
            document.getElementById('lbl-tarjeta-moneda').textContent = mSelect;
            document.getElementById('lbl-tarjeta-origen').textContent = monedaOrigen;

            const fecha = document.getElementById('c-tarjeta-fecha').value;
            const cache = getViajeCache(currentViajeId);
            const cotFechaRaw = cotizacionesTarjetaMemoria || (cache.cotizaciones || {})[fecha] || {};
            const cotFecha = decodeObjectKeys(cotFechaRaw);

            const tasaUs = cotFecha[mSelect] || (mSelect === 'AR$' ? cotFecha.ar_por_us : '') || '';
            const tasaOrigen = cotFecha[monedaOrigen] || (monedaOrigen === 'UY$' ? cotFecha.uy_por_us : '') || '';

            document.getElementById('c-tarjeta-us').value = tasaUs;
            document.getElementById('c-tarjeta-origen-us').value = tasaOrigen;
        }

        async function cargarCotizacionDiaria(fecha) {
            const cache = getViajeCache(currentViajeId);
            let cot = (cache.cotizaciones || {})[fecha] || null;

            if (FIREBASE_AVAILABLE && checkIsOnline()) {
                try {
                    const snap = await withTimeout(getRef('cotizaciones/' + fecha).once('value'));
                    if (snap.exists()) {
                        cot = snap.val();
                        cache.cotizaciones = cache.cotizaciones || {};
                        cache.cotizaciones[fecha] = cot;
                        setViajeCache(currentViajeId, cache);
                    }
                } catch (e) {}
            }

            cotizacionesTarjetaMemoria = decodeObjectKeys(cot || {});
            cargarCotizacionTarjetaActual();
        }

        async function guardarConfigEfectivo() {
            const mSelect = document.getElementById('c-efectivo-moneda').value;
            const valUs = parseFloat(document.getElementById('c-efectivo-us').value) || 0;
            const valOrigen = parseFloat(document.getElementById('c-efectivo-origen-us').value) || 0;

            cotizacionesEfectivoMemoria[mSelect] = valUs;
            cotizacionesEfectivoMemoria[monedaOrigen] = valOrigen;
            if (mSelect === 'AR$') cotizacionesEfectivoMemoria.ar_por_us = valUs;
            if (monedaOrigen === 'UY$') cotizacionesEfectivoMemoria.uy_por_us = valOrigen;

            await SyncManager.save('configuracion/efectivo', 'set', encodeObjectKeys(cotizacionesEfectivoMemoria));
            toast('Cotización Efectivo guardada');
            calcularMontoUSAuto();
        }

        async function guardarCotizacionDiaria() {
            const fecha = document.getElementById('c-tarjeta-fecha').value;
            const mSelect = document.getElementById('c-tarjeta-moneda').value;
            const valUs = parseFloat(document.getElementById('c-tarjeta-us').value) || 0;
            const valOrigen = parseFloat(document.getElementById('c-tarjeta-origen-us').value) || 0;

            cotizacionesTarjetaMemoria[mSelect] = valUs;
            cotizacionesTarjetaMemoria[monedaOrigen] = valOrigen;
            if (mSelect === 'AR$') cotizacionesTarjetaMemoria.ar_por_us = valUs;
            if (monedaOrigen === 'UY$') cotizacionesTarjetaMemoria.uy_por_us = valOrigen;

            await SyncManager.save('cotizaciones/' + fecha, 'set', encodeObjectKeys(cotizacionesTarjetaMemoria));
            toast('Cotización Tarjeta guardada');
            calcularMontoUSAuto();
        }

        function obtenerTasaMoneda(metodo, fecha, moneda) {
            if (moneda === 'US$') return 1;
            const cache = getViajeCache(currentViajeId);

            if (metodo === 'Efectivo') {
                const efRaw = cotizacionesEfectivoMemoria || (cache.configuracion || {}).efectivo || {};
                const ef = decodeObjectKeys(efRaw);
                if (ef[moneda]) return parseFloat(ef[moneda]);
                if (moneda === 'AR$' && ef.ar_por_us) return parseFloat(ef.ar_por_us);
                if (moneda === monedaOrigen && ef.uy_por_us) return parseFloat(ef.uy_por_us);
                return 1;
            } else {
                const cots = cache.cotizaciones || {};
                let cotFechaRaw = cots[fecha];
                if (!cotFechaRaw) {
                    const fechas = Object.keys(cots).sort();
                    const ant = fechas.filter(f => f <= fecha);
                    if (ant.length > 0) cotFechaRaw = cots[ant[ant.length - 1]];
                    else if (fechas.length > 0) cotFechaRaw = cots[fechas[0]];
                }
                const cotFecha = decodeObjectKeys(cotFechaRaw);
                if (cotFecha) {
                    if (cotFecha[moneda]) return parseFloat(cotFecha[moneda]);
                    if (moneda === 'AR$' && cotFecha.ar_por_us) return parseFloat(cotFecha.ar_por_us);
                    if (moneda === monedaOrigen && cotFecha.uy_por_us) return parseFloat(cotFecha.uy_por_us);
                }
                return obtenerTasaMoneda('Efectivo', fecha, moneda);
            }
        }

        function calcularMontoUSAuto() {
            if (esMontoUSManual) return;
            const monto = parseFloat(document.getElementById('g-monto').value);
            if (isNaN(monto) || monto <= 0) {
                document.getElementById('g-monto-us').value = '';
                return;
            }

            const moneda = document.getElementById('g-moneda').value;
            const metodo = document.getElementById('g-metodo').value;
            const fecha = document.getElementById('g-fecha').value;

            let montoUS = 0;
            if (moneda === 'US$') {
                montoUS = monto;
            } else {
                const tasa = obtenerTasaMoneda(metodo, fecha, moneda);
                montoUS = tasa > 0 ? (monto / tasa) : monto;
            }
            document.getElementById('g-monto-us').value = montoUS ? (Math.round(montoUS * 100) / 100) : '';
        }

        function onMontoUSManualChange() {
            esMontoUSManual = true;
        }

        async function guardarPresupuestoEstimado() {
            const data = {
                Combustible: parseFloat(document.getElementById('p-combustible').value) || 0,
                Hoteleria: parseFloat(document.getElementById('p-hoteleria').value) || 0,
                Excursiones: parseFloat(document.getElementById('p-excursiones').value) || 0,
                Alimentacion: parseFloat(document.getElementById('p-alimentacion').value) || 0,
                Otros: parseFloat(document.getElementById('p-otros').value) || 0
            };
            await SyncManager.save('configuracion/presupuesto_estimado', 'set', data);
            toast('Presupuesto estimado guardado');
        }

        async function guardarConfigViajeros() {
            const input = document.getElementById('c-viajeros').value;
            const lista = input.split(',').map(v => v.trim()).filter(v => v);
            if (lista.length === 0) return toast('Ingresá al menos un viajero');
            await SyncManager.save('configuracion/viajeros', 'set', lista);
            viajerosList = lista;
            actualizarUiViajeros();
            toast('Viajeros guardados');
        }

        function actualizarUiViajeros() {
            const selectPagador = document.getElementById('g-pagador');
            const divInvolucrados = document.getElementById('g-involucrados');
            if (viajerosList.length === 0) return;

            selectPagador.innerHTML = viajerosList.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

            divInvolucrados.innerHTML = viajerosList.map(v => `
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" value="${escapeHtml(v)}" checked class="form-checkbox h-4 w-4 text-amber-600 rounded">
                    <span>${escapeHtml(v)}</span>
                </label>
            `).join('');
        }

        document.getElementById('c-tarjeta-fecha').addEventListener('change', (e) => cargarCotizacionDiaria(e.target.value));

        let currentGastoEditId = null;

        function escapeHtml(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function resetGastoForm() {
            currentGastoEditId = null;
            esMontoUSManual = false;
            const hoy = new Date().toISOString().split('T')[0];
            document.getElementById('g-fecha').value = hoy;
            document.getElementById('g-categoria').value = 'Combustible';
            if (monedasGastoList.length > 0) document.getElementById('g-moneda').value = monedasGastoList[0];
            document.getElementById('g-monto').value = '';
            document.getElementById('g-monto-us').value = '';
            document.getElementById('g-metodo').value = 'Tarjeta';
            document.getElementById('g-detalle').value = '';
            actualizarUiViajeros();
            document.getElementById('gasto-form-titulo-texto').textContent = '📝 Registrar Nuevo Gasto';
            document.getElementById('gasto-scanner-btn').classList.remove('hidden');
            document.getElementById('btn-guardar-gasto').textContent = 'Registrar Gasto';
            document.getElementById('btn-guardar-gasto').classList.remove('bg-amber-600', 'hover:bg-amber-700');
            document.getElementById('btn-guardar-gasto').classList.add('bg-gray-800');
            document.getElementById('btn-cancelar-gasto').classList.add('hidden');
        }

        async function guardarGasto() {
            const checkboxes = document.querySelectorAll('#g-involucrados input[type="checkbox"]:checked');
            const involucrados = Array.from(checkboxes).map(cb => cb.value);

            const monto = parseFloat(document.getElementById('g-monto').value);
            const moneda = document.getElementById('g-moneda').value;
            const metodo = document.getElementById('g-metodo').value;
            const fecha = document.getElementById('g-fecha').value;

            let montoUS = parseFloat(document.getElementById('g-monto-us').value);
            if (isNaN(montoUS) || montoUS <= 0) {
                const tasa = obtenerTasaMoneda(metodo, fecha, moneda);
                montoUS = (moneda === 'US$') ? monto : (tasa > 0 ? monto / tasa : monto);
            }

            const tasaOrigen = obtenerTasaMoneda(metodo, fecha, monedaOrigen);
            let montoOrigen = 0;
            if (moneda === monedaOrigen) {
                montoOrigen = monto;
            } else {
                montoOrigen = tasaOrigen > 0 ? montoUS * tasaOrigen : montoUS;
            }

            montoUS = Math.round(montoUS * 100) / 100;
            montoOrigen = Math.round(montoOrigen * 100) / 100;

            const data = {
                fecha: fecha,
                categoria: document.getElementById('g-categoria').value,
                moneda: moneda,
                monto: monto,
                montoUS: montoUS,
                montoOrigen: montoOrigen,
                monedaOrigen: monedaOrigen,
                metodo: metodo,
                detalle: document.getElementById('g-detalle').value,
                pagador: document.getElementById('g-pagador').value || 'Sin asignar',
                involucrados: involucrados.length > 0 ? involucrados : (viajerosList.length > 0 ? viajerosList : ['Sin asignar'])
            };

            if (!data.fecha || isNaN(data.monto)) return toast('Faltan fecha o monto');

            if (currentGastoEditId) {
                await SyncManager.save('gastos/' + currentGastoEditId, 'update', data);
                toast('Gasto actualizado');
                resetGastoForm();
            } else {
                data.timestamp = "TIMESTAMP";
                await SyncManager.save('gastos', 'push', data);
                document.getElementById('g-monto').value = '';
                document.getElementById('g-monto-us').value = '';
                document.getElementById('g-detalle').value = '';
                toast('Guardado');
            }
            esMontoUSManual = false;
            cargarUltimosGastos();
        }

        async function editarGasto(id) {
            const cache = getViajeCache(currentViajeId);
            let g = (cache.gastos || []).find(x => x.id === id);
            if (!g) g = mergeQueued(cache.gastos || [], 'gastos').find(x => x.id === id);
            if (!g) return toast('No se encontró el gasto');

            currentGastoEditId = id;
            esMontoUSManual = true;
            document.getElementById('g-fecha').value = g.fecha || '';
            document.getElementById('g-categoria').value = g.categoria || 'Otros';
            if (g.moneda) document.getElementById('g-moneda').value = g.moneda;
            document.getElementById('g-monto').value = g.monto != null ? g.monto : '';
            document.getElementById('g-monto-us').value = g.montoUS != null ? g.montoUS : '';
            document.getElementById('g-metodo').value = g.metodo || 'Tarjeta';
            document.getElementById('g-detalle').value = g.detalle || '';

            actualizarUiViajeros();
            const selectPagador = document.getElementById('g-pagador');
            if (g.pagador && ![...selectPagador.options].some(o => o.value === g.pagador)) {
                const opt = document.createElement('option');
                opt.value = g.pagador;
                opt.textContent = g.pagador;
                selectPagador.appendChild(opt);
            }
            if (g.pagador) selectPagador.value = g.pagador;

            const invol = Array.isArray(g.involucrados) ? g.involucrados : [];
            document.querySelectorAll('#g-involucrados input[type="checkbox"]').forEach(cb => {
                cb.checked = invol.length === 0 ? true : invol.includes(cb.value);
            });

            document.getElementById('gasto-form-titulo-texto').textContent = '✏️ Editando gasto';
            document.getElementById('gasto-scanner-btn').classList.add('hidden');
            document.getElementById('btn-guardar-gasto').textContent = 'Guardar cambios';
            document.getElementById('btn-guardar-gasto').classList.remove('bg-gray-800');
            document.getElementById('btn-guardar-gasto').classList.add('bg-amber-600', 'hover:bg-amber-700');
            document.getElementById('btn-cancelar-gasto').classList.remove('hidden');

            document.getElementById('gasto-form-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        async function cargarUltimosGastos() {
            const cache = getViajeCache(currentViajeId);
            let arr = [];

            if (FIREBASE_AVAILABLE && navigator.onLine) {
                try {
                    const snap = await withTimeout(getRef('gastos').orderByChild('fecha').once('value'));
                    snap.forEach(c => { arr.push({ ...c.val(), id: c.key }); });
                    cacheCollection(currentViajeId, 'gastos', arr);
                } catch (e) {
                    arr = cache.gastos || [];
                }
            } else {
                arr = cache.gastos || [];
            }

            arr = mergeQueued(arr, 'gastos');
            arr.sort((a, b) =>
                (b.fecha || '').localeCompare(a.fecha || '') ||
                ((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)) ||
                String(b.id || '').localeCompare(String(a.id || ''))
            );

            const countEl = document.getElementById('gastos-count');
            if (countEl) countEl.textContent = arr.length ? `(${arr.length})` : '';

            const fmtNum = (v) => {
                const n = parseFloat(v);
                if (isNaN(n)) return '—';
                // Quita ceros innecesarios: 1200.50 → "1200.5", 1200.00 → "1200"
                return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false });
            };
            document.getElementById('lista-gastos-admin').innerHTML = arr.length ? arr.map(d => {
                const invol = Array.isArray(d.involucrados) ? d.involucrados.join(', ') : '';
                const editing = currentGastoEditId === d.id;
                const origVal = d.monedaOrigen || monedaOrigen;
                const valUS = d.montoUS != null ? fmtNum(d.montoUS) : '—';
                const valOrig = d.montoOrigen != null ? fmtNum(d.montoOrigen) : '—';
                const valMonto = d.monto != null ? fmtNum(d.monto) : '—';

                return `
                <tr class="border-b ${editing ? 'bg-amber-50' : ''}">
                    <td class="py-2 pr-2 whitespace-nowrap">${escapeHtml(d.fecha)}</td>
                    <td class="pr-2">${escapeHtml(d.categoria)}</td>
                    <td class="pr-2 max-w-[10rem] truncate" title="${escapeHtml(d.detalle || '')}">${escapeHtml(d.detalle || '—')}</td>
                    <td class="pr-2"><span class="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded font-bold">${escapeHtml(d.pagador || 'N/A')}</span></td>
                    <td class="pr-2 text-xs text-gray-600">${escapeHtml(invol || '—')}</td>
                    <td class="pr-2 whitespace-nowrap font-medium">${escapeHtml(d.moneda)} ${valMonto} <span class="text-gray-400 text-xs">(${escapeHtml(d.metodo)})</span></td>
                    <td class="pr-2 whitespace-nowrap font-bold text-amber-700">US$ ${escapeHtml(valUS)}</td>
                    <td class="pr-2 whitespace-nowrap text-emerald-700 font-medium">${escapeHtml(origVal)} ${escapeHtml(valOrig)}</td>
                    <td class="whitespace-nowrap text-right">
                        <button onclick="editarGasto('${escapeHtml(d.id)}')" class="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs font-bold mr-1 hover:bg-blue-100">Editar</button>
                        <button onclick="eliminarGasto('${escapeHtml(d.id)}')" class="text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-bold hover:bg-red-100">Borrar</button>
                    </td>
                </tr>`;
            }).join('') : '<tr><td colspan="9" class="py-4 text-gray-400 italic">No hay gastos registrados.</td></tr>';
        }

        async function eliminarGasto(id) {
            if (confirm('¿Borrar este gasto?')) {
                await SyncManager.save('gastos/' + id, 'remove');
                if (currentGastoEditId === id) resetGastoForm();
                cargarUltimosGastos();
            }
        }

        function toast(m) { const e = document.getElementById('toast'); e.textContent = m; e.classList.remove('hidden'); setTimeout(() => e.classList.add('hidden'), 3000); }

        /* ---------------- Etiquetas de los botones "solo ícono" ----------------
           En el celular no existen los tooltips del navegador, así que además del
           title / aria-label cada botón guarda su nombre en data-label y, al
           mantenerlo pulsado ~0,5 s, aparece un aviso con ese nombre. */
        function iconBadge(n) {
            if (!n) return '';
            return `<span class="icon-badge">${n > 99 ? '99+' : n}</span>`;
        }
        function etiquetaBoton(el) {
            if (!el) return '';
            return el.dataset && el.dataset.label ? el.dataset.label : (el.getAttribute('aria-label') || el.title || '');
        }
        (function initEtiquetasIconos() {
            let timer = null;
            const cancelar = () => { if (timer) { clearTimeout(timer); timer = null; } };
            const programar = (target, ms) => {
                const btn = target && target.closest ? target.closest('.icon-btn, .nav-tab') : null;
                if (!btn) return;
                cancelar();
                timer = setTimeout(() => {
                    timer = null;
                    const txt = etiquetaBoton(btn);
                    if (txt) toast('ℹ️ ' + txt);
                }, ms);
            };
            document.addEventListener('touchstart', e => programar(e.target, 450), { passive: true });
            document.addEventListener('mousedown', e => programar(e.target, 600));
            ['touchend', 'touchcancel', 'touchmove', 'scroll', 'mouseup', 'mouseleave', 'dragstart']
                .forEach(ev => document.addEventListener(ev, cancelar, { passive: true }));
        })();



        /* ================= INVITAR A SEGUIR EL VIAJE (WhatsApp) =================
           Arma el enlace público del viaje que se está viendo
           (viaje.html?user=...&id=...), lo acorta para que el mensaje quede corto
           y abre WhatsApp con la invitación ya escrita y el selector de contactos.

           Notas de por qué está hecho así:
           • El enlace lleva user+id porque viaje.html, sin parámetros, muestra
             "Borrador local" en vez del viaje.
           • En la APK (WebView) window.open suele estar bloqueado: se intentan
             varias vías y, si ninguna abre WhatsApp, aparece el mensaje en un
             aviso para copiarlo y pegarlo a mano (nunca se pierde la invitación).
           • El acortado se guarda en caché: el mismo viaje no se acorta dos veces.
           ---------------------------------------------------------------------- */
        const INVITAR = {
            sitio: 'https://appsparavos-ops.github.io/Viajes/viaje.html',
            // 'directo' = al tocar 📤 abre WhatsApp con el mensaje listo.
            // 'modal'   = antes de enviar, muestra el texto para revisarlo o editarlo.
            modo: 'directo',
            texto: '🚗 *Bitácora de Viaje* — ¡Te invito a seguir nuestro viaje «{titulo}»!\n' +
                   '📸 Fotos, relatos y recorrido GPS en vivo.\n' +
                   '👉 clic aquí: {link}',
            // Acortadores públicos, en orden de preferencia. Si todos fallan
            // (sin internet, servicio caído), se usa el enlace completo.
            acortadores: [
                u => 'https://da.gd/shorten?url=' + encodeURIComponent(u),
                u => 'https://clck.ru/--?url=' + encodeURIComponent(u)
            ]
        };

        /* Devuelve el enlace público del viaje actual, o null si falta algo. */
        function enlaceInvitacion() {
            if (!currentUsername || !currentViajeId) return null;
            return `${INVITAR.sitio}?user=${encodeURIComponent(currentUsername)}&id=${encodeURIComponent(currentViajeId)}`;
        }

        /* Acorta el enlace con el primer servicio que responda. */
        async function acortarEnlace(largo) {
            const CLAVE = 'travelapp_inv_short';
            try {
                const cache = JSON.parse(localStorage.getItem(CLAVE) || '{}');
                if (cache[largo]) return cache[largo];   // ya lo acortamos antes
            } catch (e) { /* caché ilegible: se sigue igual */ }

            for (const crear of INVITAR.acortadores) {
                try {
                    const ctrl = new AbortController();
                    const t = setTimeout(() => ctrl.abort(), 6000);
                    const r = await fetch(crear(largo), { signal: ctrl.signal });
                    clearTimeout(t);
                    const txt = (await r.text()).trim();
                    if (r.ok && /^https?:\/\/\S+$/.test(txt) && txt.length < largo.length) {
                        try {
                            const cache = JSON.parse(localStorage.getItem(CLAVE) || '{}');
                            cache[largo] = txt;
                            localStorage.setItem(CLAVE, JSON.stringify(cache));
                        } catch (e) { /* sin almacenamiento: no pasa nada */ }
                        return txt;
                    }
                } catch (e) { /* se prueba el siguiente acortador */ }
            }
            return largo;
        }

        /* Mensaje final, con el título del viaje y el enlace ya resueltos. */
        function armarMensajeInvitacion(link) {
            const titulo = (typeof tituloViajeActual === 'function' ? tituloViajeActual() : '') || 'nuestro viaje';
            return INVITAR.texto.replace('{titulo}', titulo).replace('{link}', link);
        }

        /* Abre WhatsApp con el mensaje. Se prueban varias vías porque los
           empaquetadores de la APK bloquean parte de ellas:
             1) WhatsApp instalado (esquema whatsapp:// o window.open _system)
             2) WhatsApp Web (wa.me) en pestaña nueva
             3) Si nada abrió, se llama a alFallar() para que el usuario pueda
                copiar el mensaje (nunca queda sin poder invitar). */
        function enviarPorWhatsApp(texto, alFallar) {
            const enc = encodeURIComponent(texto);
            const app = 'whatsapp://send?text=' + enc;
            const web = 'https://wa.me/?text=' + enc;
            const esMovil = !!window.cordova || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

            const clickOculto = (href, target) => {
                const a = document.createElement('a');
                a.href = href;
                if (target) { a.target = target; a.rel = 'noopener'; }
                a.style.display = 'none';
                document.body.appendChild(a);
                if (typeof a.click === 'function') a.click();
                setTimeout(() => a.remove(), 0);
                return a;
            };

            if (esMovil) {
                // 1) App nativa vía Cordova/InAppBrowser
                let abrio = false;
                try { abrio = !!window.open(app, '_system'); } catch (e) { abrio = false; }
                if (!abrio) clickOculto(app);
                // 2) Si la página sigue visible, la app no se abrió: probamos wa.me
                setTimeout(() => {
                    if (document.visibilityState !== 'visible') return;   // se abrió WhatsApp
                    clickOculto(web, '_blank');
                    setTimeout(() => {
                        if (document.visibilityState === 'visible' && typeof alFallar === 'function') alFallar();
                    }, 1200);
                }, 1600);
            } else {
                // Escritorio: WhatsApp Web / app de escritorio
                let w = null;
                try { w = window.open(web, '_blank'); } catch (e) { w = null; }
                if (!w) { clickOculto(web, '_blank'); }
                setTimeout(() => {
                    if (!w && typeof alFallar === 'function') alFallar();
                }, 600);
            }
        }

/* Copia al portapapeles con respaldo: en la APK/WebView la API moderna
           puede no existir o rechazar la operación (contexto no seguro). */
        function copiarTexto(texto) {
            const respaldo = () => new Promise(resolve => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = texto;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, ta.value.length);
                    document.execCommand('copy');
                    ta.remove();
                } catch (e) { /* sin permiso: igual se avisa al usuario */ }
                resolve();
            });
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(texto).catch(respaldo);
                }
            } catch (e) { /* se usa el respaldo */ }
            return respaldo();
        }

        /* ---------------- Modal de invitación (respaldo y modo 'modal') -------- */
        function abrirModalInvitar(mensaje, link, aviso) {
            const m = document.getElementById('modal-invitar');
            if (!m) {   // sin modal (por ejemplo, si se quitó del HTML): se copia y listo
                copiarTexto(mensaje).then(() => toast('📋 Invitación copiada. Pegala en WhatsApp.'));
                return;
            }
            const ta = document.getElementById('invitar-mensaje');
            const enlace = document.getElementById('invitar-enlace');
            const nota = document.getElementById('invitar-aviso');
            if (ta) ta.value = mensaje;
            if (enlace) enlace.textContent = link || '';
            if (nota) nota.classList.toggle('hidden', !aviso);
            m.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
        function cerrarModalInvitar() {
            const m = document.getElementById('modal-invitar');
            if (m) m.classList.add('hidden');
            document.body.style.overflow = '';
        }
        function enviarInvitacionWhatsApp() {
            const ta = document.getElementById('invitar-mensaje');
            const texto = ta ? ta.value : '';
            if (!texto) return;
            enviarPorWhatsApp(texto, () => {
                copiarTexto(texto).then(() => toast('📋 No pudimos abrir WhatsApp: la invitación quedó copiada.'));
            });
        }
        function copiarInvitacion() {
            const ta = document.getElementById('invitar-mensaje');
            copiarTexto(ta ? ta.value : '').then(() => toast('📋 Mensaje copiado. Pegalo en WhatsApp.'));
        }
        function copiarEnlaceInvitacion() {
            const el = document.getElementById('invitar-enlace');
            copiarTexto(el ? el.textContent : '').then(() => toast('🔗 Enlace copiado.'));
        }

        /* Título del viaje que está seleccionado en el panel. */
        function tituloViajeActual() {
            try {
                const lista = getCache(CACHE.viajes) || [];
                const v = lista.find(x => x.id === currentViajeId);
                if (v && v.titulo) return v.titulo;
            } catch (e) { /* se usa el selector */ }
            try {
                const sel = document.getElementById('select-viaje');
                if (sel && sel.selectedIndex >= 0) {
                    const t = (sel.options[sel.selectedIndex].text || '')
                        .replace(/[✅⛔]/g, '').replace(/\(offline\)/i, '').trim();
                    if (t && !/^cargando/i.test(t)) return t;
                }
            } catch (e) { /* sin título: se usa el texto genérico */ }
            return '';
        }

        /* Botón 📤 del encabezado. */
        async function invitarAlViaje() {
            if (modoBorrador) {
                toast('🧾 Estás en modo borrador: iniciá sesión y sincronizá el viaje para poder invitarlo.');
                return;
            }
            const largo = enlaceInvitacion();
            if (!largo) { toast('Elegí un viaje antes de invitar.'); return; }

            toast('📤 Preparando la invitación…');
            const link = await acortarEnlace(largo);
            const mensaje = armarMensajeInvitacion(link);

            if (INVITAR.modo === 'modal') {
                abrirModalInvitar(mensaje, link);
            } else {
                enviarPorWhatsApp(mensaje, () => abrirModalInvitar(mensaje, link, true));
            }
        }

        initCloudinaryWidget();

        // Control de sesión y autenticación al inicio.
        // Estrategia "resolver antes de mostrar": la pantalla de carga (boot-screen)
        // cubre toda la página mientras Firebase decide si hay sesión o no. Solo cuando
        // la decisión está tomada se oculta la carga y se revela el panel
        // (onUserAuthenticated) o el modal de login (confirmarSinSesion), ambos en un
        // único instante. Así no parpadean ni la página ni el modal.
        if (FIREBASE_AVAILABLE && auth) {
            let authDecideTimer = null;

            function confirmarSinSesion() {
                clearTimeout(authDecideTimer);
                authUser = null;
                currentUsername = null;
                localStorage.removeItem('travelapp_active_user');
                const infoBar = document.getElementById('user-info-bar');
                if (infoBar) {
                    infoBar.classList.add('hidden');
                    infoBar.classList.remove('flex');
                }
                // Oculta la pantalla de carga y muestra el login en el mismo instante.
                // (Si no hay conexión, el modal muestra un aviso: la primera vez o tras
                // cerrar sesión, Firebase exige internet.)
                showAuthModal('credentials');
            }

            function decidirSinSesion() {
                if (auth.currentUser || authUser) return;
                // Si este dispositivo venia en modo borrador, retomar ahi en lugar de
                // bloquear con el login (permite trabajar sin cuenta ni conexion).
                if (hayModoBorradorActivo()) { entrarModoBorrador(); return; }
                confirmarSinSesion();
            }

            // Entrada directa con la sesión del dispositivo: usa el nombre de usuario
            // recordado en este dispositivo (entrar sin conexión durante el viaje).
            function entrarConSesionDeDispositivo() {
                try {
                    const cachedUser = (localStorage.getItem('travelapp_active_user') || '').trim();
                    if (cachedUser && cachedUser !== 'null') {
                        currentUsername = cachedUser;
                        onUserAuthenticated(); // revela el panel (modo offline)
                        return true;
                    }
                } catch (e) { /* ignorar */ }
                return false;
            }

            auth.onAuthStateChanged(async user => {
                clearTimeout(authDecideTimer);

                if (user) {
                    authUser = user;

                    // Sin internet: no se puede consultar el perfil en Firebase (la
                    // lectura colgaría esperando la red). Si este dispositivo recuerda
                    // al usuario, entrar directo en modo offline; si no, avisar.
                    if (!hayConexion()) {
                        if (!entrarConSesionDeDispositivo()) confirmarSinSesion();
                        return;
                    }

                    // Online: consultar si ya tiene un username asignado en /users/{uid}
                    try {
                        const snap = await db.ref(`users/${user.uid}`).once('value');
                        if (snap.exists() && snap.val().username) {
                            currentUsername = snap.val().username;
                            localStorage.setItem('travelapp_active_user', currentUsername);
                            onUserAuthenticated(); // revela el panel (oculta la carga)
                        } else {
                            // Usuario sin username: solicitar que elija uno
                            showAuthModal('username');
                        }
                    } catch (e) {
                        console.error('Error al verificar perfil de usuario en Firebase:', e);
                        // Fallback offline/caché si el usuario ya tenía sesión guardada
                        if (!entrarConSesionDeDispositivo()) showAuthModal('username');
                    }
                    return;
                }

                // Sin sesión por ahora: puede ser un estado transitorio mientras Firebase
                // restaura una sesión guardada (SESSION/LOCAL). Mientras tanto la pantalla
                // de carga sigue cubriendo la página; solo pedimos login cuando es seguro
                // que no hay sesión que restaurar. Sin conexión decidimos rápido.
                const sinRed = !hayConexion();
                const haySesionPendiente = tieneSesionGuardada();
                authDecideTimer = setTimeout(decidirSinSesion, sinRed ? 300 : (haySesionPendiente ? 5000 : 700));
            });
        } else {
            // Firebase no disponible (p. ej. se abrió el HTML sin subir lib/ ni
            // firebase-config.js, o se sirvió desde un origen sin esos archivos).
            // NO inventar una sesión local: eso producía un falso "@null". Avisar.
            mostrarSinFirebase();
        }
    