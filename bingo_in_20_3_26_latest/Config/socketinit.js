const jwt = require('jsonwebtoken');
const { sanitizeInput } = require("../gamehelper/all");
module.exports = function socketInit(Sys, sessionMiddleware) {
    try {
        Sys.Io = require('socket.io')(Sys.Server, {
            pingTimeout: Sys.Config.Socket?.pingTimeout || 60000,
            pingInterval: Sys.Config.Socket?.pingInterval || 25000
        });

        Sys.Io.use((socket, next) => {
            sessionMiddleware(socket.request, {}, next);
        });

        Sys.Log.info('Loading... Socket');

        const whitelist = [
            "LoginPlayer",
            "ReconnectPlayer",
            "PlayerDetails",
            "Logout",
            "HallList",
            "ScreenSaver",
            "RefreshAccessToken",
            "AdminHallDisplayLogin",
            "WheelOfFortuneData",
            "TreasureChestData",
            "SelectTreasureChest",
            "MysteryGameData",
            "SelectMystery",
            "ColorDraftGameData",
            "SelectColorDraft",
            "StopGameByPlayers",
            "TvscreenUrlForPlayers",
            "UpdateFirebaseToken",
            "playerForgotPassword",
            "disconnect"
        ];

        // Wrap a handler safely
        function secureSocket(socket, skipJwt) {
            const originalOnevent = socket.onevent;
            
            socket.onevent = function(packet) {
                const eventName = packet.data[0];
                let data = packet.data[1];
        
                // Sanitize the incoming data
                const cleanData = sanitizeInput(data);
                //console.log("called event---", eventName, skipJwt, socket?.request?.session)
                // JWT check for non-whitelisted events
                if (skipJwt) {
                    // Admin namespace: check session on every event
                    const sess = socket?.request?.session;
                    
                    if (!sess || !sess?.login) {
                        console.log("not able to access admin socket events")
                        return; // prevent event processing
                    }
                }else{
                    if (!whitelist.includes(eventName)) {
                        const token = socket.handshake.query.authToken;
                        
                        if (!token) {
                            console.log("Auth required for event", eventName)
                            socket.emit('authError', { message: `Auth required for event "${eventName}"` });
                            return;
                        }
                        try {
                            const user = jwt.verify(token, process.env.JWT_SECRET);
                            //console.log("user of verified player", eventName, user)
                            socket.user = user;
                            // **Override playerId from token**
                            if (cleanData.playerId && cleanData.playerId !== user.id) {
                                // Client is trying to spoof another user
                                console.warn(`playerId mismatch! Socket: ${socket.id}, event: ${eventName}`);
                                socket.emit('authError', { message: `Invalid playerId for event "${eventName}"` });
                                return; // stop processing this event
                            }
                            // optional: could still override to be extra safe
                            cleanData.playerId = user.id;
                        } catch (err) {
                            socket.emit('authError', { message: `Invalid token for event "${eventName}"` });
                            return;
                        }
                    }else{
                        //console.log("dont call--", eventName)
                    }
                }

                // Replace the original data with sanitized version and continue
                if (eventName === 'ReconnectPlayer' || eventName === 'LoginPlayer') {
                    console.log('[BIN-134-DIAG] secureSocket passing event:', eventName, 'socketId:', socket.id, 'playerId:', cleanData?.playerId);
                }
                packet.data[1] = cleanData;
                originalOnevent.call(this, packet);
            };
        }

        // Default namespace /
        Sys.Io.on('connection', socket => {
            Sys.Log.info('[Default] Connected: ' + socket.id);
            socket.language = '';

            // BIN-134: Auth-beacon — send current auth state on connect (eliminates race condition)
            if (socket.handshake.query.role === 'authBeacon') {
                try {
                    // Socket.IO v2 uses io.sockets.connected (object), v4+ uses io.sockets.sockets (Map)
                    const sockets = Sys.Io.sockets.connected || Sys.Io.sockets.sockets || {};
                    const entries = (sockets instanceof Map) ? Array.from(sockets.values()) : Object.values(sockets);
                    console.log('[BIN-134] Auth-beacon lookup:', entries.length, 'sockets,',
                        entries.filter(s => s.playerId && s.authToken).length, 'with auth');
                    for (let i = 0; i < entries.length; i++) {
                        if (entries[i].playerId && entries[i].authToken) {
                            socket.emit('_playerAuthenticated', {
                                playerId: entries[i].playerId,
                                token: entries[i].authToken
                            });
                            Sys.Log.info('[BIN-134] Auth-beacon: sent existing auth to new beacon socket');
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('[BIN-134] Auth-beacon lookup error:', e.message);
                }
                // Auth-beacon doesn't need game event handlers — return early
                socket.on('disconnect', reason => {
                    Sys.Log.info(`[Default] Auth-beacon disconnected: ${socket.id} Reason: ${reason}`);
                });
                return;
            }

            secureSocket(socket); // Wrap all events
            // Register common sockets
            if (Sys.Game?.Common?.Sockets) {
                Object.keys(Sys.Game.Common.Sockets).forEach(key => {
                    try { Sys.Game.Common.Sockets[key](socket); }
                    catch (e) { console.error(`[SocketInit][CommonSockets] Error ${key}:`, e); }
                });
            }

            // Only one disconnect listener per socket
            socket.on('disconnect', reason => {
                Sys.Log.info(`[Default] Some One disconnected: ${socket.id} Reason: ${reason}`);
            });

            socket.on('error', err => console.error(`[Default] Socket error:`, err));
        });

        // Game/Admin namespaces
        const nsList = [
            { name: Sys.Config.Namespace.Game1, sockets: Sys.Game.Game1.Sockets, skipJwt: false },
            { name: Sys.Config.Namespace.Game2, sockets: Sys.Game.Game2.Sockets, skipJwt: false },
            { name: Sys.Config.Namespace.Game3, sockets: Sys.Game.Game3.Sockets, skipJwt: false },
            { name: Sys.Config.Namespace.Game4, sockets: Sys.Game.Game4.Sockets, skipJwt: false },
            { name: Sys.Config.Namespace.Game5, sockets: Sys.Game.Game5.Sockets, skipJwt: false },
            { name: '/admin', sockets: Sys.Game.AdminEvents.Sockets, skipJwt: true }
        ];

        nsList.forEach(({ name, sockets, skipJwt }) => {
            Sys.Io.of(name).on('connection', socket => {
                console.log(`User connected to ${name}: ${socket.id}`);
                // For admin namespace, check session instead of JWT
                if (skipJwt) {
                    const sess = socket.request.session;
    
                    if (!sess || !sess?.login) {
                        console.log("not able to access admin socket events")
                        return socket.disconnect(true);
                    }
                    //socket.user = sess.user;
                }

                secureSocket(socket, skipJwt);

                // BIN-134: Register common sockets on game namespaces too
                // Unity connects to game namespaces only, so ReconnectPlayer/LoginPlayer
                // must be available there for auth-beacon to work.
                if (!skipJwt && Sys.Game?.Common?.Sockets) {
                    Object.keys(Sys.Game.Common.Sockets).forEach(key => {
                        try { Sys.Game.Common.Sockets[key](socket); }
                        catch (e) { console.error(`[SocketInit][${name}][CommonSockets] Error ${key}:`, e); }
                    });
                }

                if (sockets) {
                    Object.keys(sockets).forEach(key => {
                        try { sockets[key](socket); }
                        catch (e) { console.error(`[SocketInit][${name}] Handler error ${key}:`, e); }
                    });
                }

                // Disconnect only for this namespace
                socket.on('disconnect', reason => {
                    //Sys.Log.info(`[${name}] Some One disconnected: ${socket.id} Reason: ${reason}`);
                });

                socket.on('error', err => console.error(`[${name}] Socket error:`, err));
            });
        });

        return Sys.Io;

    } catch (err) {
        console.error("[SocketInit] Fatal error:", err);
        throw err;
    }
};
