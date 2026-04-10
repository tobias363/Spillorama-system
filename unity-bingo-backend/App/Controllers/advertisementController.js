const Sys = require('../../Boot/Sys');
const axios = require('axios');
const { getSingleTraslateData } = require('../../Helper/bingo');
const { sendPushNotificationMultiple } = require('../../Helper/gameHelper');
const config = Sys.Config.App[Sys.Config.Database.connectionType];

const admin = require("firebase-admin");

let firebaseInitialized = false;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: process.env.FIREBASE_ADMIN_DB_URL
            });
        }
        firebaseInitialized = true;
    } else {
        console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — Firebase Realtime Database notifications disabled');
    }
} catch (err) {
    console.error('Failed to initialize Firebase Admin:', err.message);
}

module.exports = {
    view: async (req, res) => {
        const language = req.session.details.language ??  "norwegian";
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['SMS Advertisement'] || [];
                let stringReplace =req.session.details.isPermission['SMS Advertisement'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            const keysArray = [
                "sms_advertisement",
                "dashboard",
                "select_notification_type",
                "send_personal_message",
                "send_a_hall_message_to_everyone_in_a_hall",
                "please_enter_2_or_more_characters",
                "send_a_message_to_all_users",
                "send_a_message_to_a_group",
                "select_player",
                "enter_message",
                "select_hall",
                "select_group_of_halls",
                "message_type",
                "push_notification",
                "search_username",
                "message",
                "send",
                "player",
                "table",
                "search",
                "all",
                "active",
                "inactive",
                "blockeds",
                "approved",
                "customer_number",
                "phone_number",
                "by",
                "action",
                "previous",
                "next",
                "show",
                "entries",
                "translation_history",
                "delete",
                "balance",
                "add",
                "emailId",
                "username",
                "status",
                "hall_name",
                "are_you_sure",
                "success",
                "something_went_wrong",
                "yes",
                "no",
            ];

            const halls = await Sys.App.Services.HallServices.getHallsByData({ status: 'active' }, { _id: 1, name: 1 });
            const group_of_halls = await Sys.App.Services.HallServices.getGroupOfHallsByData({ status: 'active' }, { _id: 1, name: 1 });
            let translate = await Sys.Helper.bingo.getTraslateData(keysArray, language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                smsAdvertisementActive: 'active',
                navigation: translate,
                translate: translate,
                language: language,
                halls,
                group_of_halls,
                viewFlag,
                editFlag
            };
            if(viewFlag){
                return res.render('advertisement/index', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }
        } catch (error) {
            console.log("Error in view:", error);
            return res.status(500).json({ error: getSingleTraslateData(["invalid_prize_draw_values"], language) });
        }
        
    },

    // Search players by name or phone number
    searchPlayers: async (req, res) => {
        const language = req.session.details.language ??  "norwegian";
        try {
            const { player } = req.query;
            if (!player || player.length < 2) {
                return res.json({ players: [] });
            }

            // Search players by name or phone number
            const players = await Sys.App.Services.PlayerServices.getAllPlayersData(
                {
                    $or: [
                        //{ $expr: { $regexMatch: { input: { $toString: "$customerNumber" }, regex: `^${player}`, options: "i" } } }, // Starts with customerNumber
                        { username: { $regex: `^${player}`, $options: "i" } }, // Starts with username
                        //{ phone: { $regex: `^${player}`, $options: "i" } }, // Starts with phone number
                    ],
                    status: 'Active'
                },
                { _id: 1, username: 1, customerNumber: 1, phone: 1 }
            );
            console.log("players", players);
            return res.json({ players });
        } catch (error) {
            console.log("Error in searchPlayers:", error);
            return res.status(500).json({ error: await getSingleTraslateData(["internal_server_error"], language) });
        }
    },

    // Send SMS & Push Notification
    sendSmsNotification: async (req, res) => {
        const language = req.session.details.language ??  "norwegian";
        try {
            const { notificationType, playerId, hallId, groupId, sendType, message } = req.body;
            console.log("notification data---", notificationType, playerId, hallId, groupId, sendType, message);
            
            // Dont need to send notifications to paused or blocked playes
            // pause check is pending
            // Get recipients based on notification type
            let query = {
                status: 'Active',
                userType: 'Online'
            };
              
            if (notificationType === 'personal') {
                query._id = { $in: playerId };
            } else if (notificationType === 'hall') {
                Object.assign(query, {
                    'approvedHalls.status': 'Approved',
                    'approvedHalls.id': { $in: hallId },
                });
            } else if (notificationType === 'group') {
                Object.assign(query, {
                    'approvedHalls.status': 'Approved',
                    'approvedHalls.groupHall.id': { $in: groupId },                    
                });
            }
              
            const players = await Sys.App.Services.PlayerServices.getAllPlayersData(query, { _id: 1, phone: 1, firebaseToken: 1 });
        
            const phoneNumbers = [];
            const firebaseTokensSet = new Set();
            const windowsTokens = [];
            let errors = [];
            let success = [];

            for (const player of players) {
                if (player.phone) {
                    phoneNumbers.push(player.phone);
                }
                if (player.firebaseToken) {
                    if(player.firebaseToken.includes('windowsTrayApp')) {
                        windowsTokens.push(player._id.toString());
                    } else {
                        firebaseTokensSet.add(player.firebaseToken);
                    }
                }
            }
            
            const firebaseTokens = Array.from(firebaseTokensSet);
            console.log("phoneNumbers", phoneNumbers);
            console.log("firebaseTokens", firebaseTokens);

            // Send notifications based on type
            if (sendType.includes('sms') && phoneNumbers.length > 0) {
                const smsResult = await module.exports.sendBulkSMS(phoneNumbers, message, language);
                if (!smsResult.success) {
                    errors.push(smsResult.message);
                } else {
                    success.push(smsResult.message);
                }
            }
        
            if (sendType.includes('push') && firebaseTokens.length > 0) {
                const pushResult = await module.exports.sendPushNotification(firebaseTokens, message, language);
                if (!pushResult.success) {
                    errors.push(pushResult.message);
                } else {
                    success.push(pushResult.message);
                }
            } 

            if (sendType.includes('push') && windowsTokens.length > 0) {
                module.exports.sendWindowsToastNotification(windowsTokens, message);
            } 

            if (errors.length > 0) {
                const combinedMessages = success.length > 0 ? `${success.join(', ')} But ${errors.join(', ')}` : errors.join(', ');

                return res.status(207).json({ 
                    success: false, 
                    message: combinedMessages,
                });
            }

            return res.json({ success: true, message: await getSingleTraslateData(["notification_sent_successfully"], language) });

        } catch (error) {
            console.log("Error in sendSmsNotification:", error);
            return res.status(500).json({ error: await getSingleTraslateData(["internal_server_error"], language) });
        }
    },

    sendBulkSMS: async (phoneNumbers, msg, language) => {
        const baseUrl = 'https://sveve.no/SMS/SendMessage';
        try {
            const to = phoneNumbers.join(',');
            const user = config.sveve_username;
            const passwd = config.sveve_password;
            const from = config.sveve_sender;
            console.log("user", user);
            console.log("passwd", passwd);
            console.log("from", from);
            console.log("to", to);
            console.log("msg", msg);
            const params = {
                user,
                passwd,
                to,
                msg,
                from,
                f: 'json',  // Request JSON response
                reply: false,
                //test: true
            };
            //console.log("params", params);
            const response = await axios.get(baseUrl, { params });
            console.log("response", response);
            const res = response.data.response;

            if (res.fatalError) {
                console.error(' Fatal error:', res.fatalError);
                return {
                    success: false,
                    message: await getSingleTraslateData(["something_went_wrong_while_sending_sms"], language),
                };
            } 

            if (res.msgOkCount > 0) {
                console.log(`SMS sent to ${res.msgOkCount} recipient(s). Units used: ${res.stdSMSCount}`);
            }

            if (res.ids?.length) {
                console.log('Message IDs:', res.ids);
            }

            if (res.errors?.length > 0) {
                res.errors.forEach(err => {
                    console.warn(` Failed: ${err.number} => ${err.message}`);
                });
    
                const allFailed = res.errors.length >= phoneNumbers.length;
    
                return {
                    success: !allFailed,
                    message: allFailed 
                        ? await getSingleTraslateData(["something_went_wrong_while_sending_sms"], language)
                        : await getSingleTraslateData(["some_sms_failed_to_send"], language)
                };
            }
            
            return {
                success: true,
                message: await getSingleTraslateData(["sms_sent_successfully"], language),
            };

        } catch (error) {
            console.error('Failed to send SMS:', error.message, error);
            return {
                success: false,
                message: await getSingleTraslateData(["something_went_wrong_while_sending_sms"], language),
            };
        }
    },

    sendPushNotification: async (firebaseTokens, message, language) => {
        try {
            console.log("sendPushNotification", firebaseTokens, message);
    
            const pushMessage = {
                notification: {
                    title: "Spillorama Bingo",
                    body: message
                },
                // apns: {
                //     headers: {
                //         "apns-priority": "10"
                //     },
                //     payload: {
                //         aps: {
                //             alert: {
                //                 title: "Spillorama Bingo",
                //                 body: message
                //             },
                //             sound: "default",
                //             badge: 1
                //         }
                //     }
                // },
            };
    
            sendPushNotificationMultiple(pushMessage, firebaseTokens);
            
            return {
                success: true,
                message: await getSingleTraslateData(["push_notification_sent_successfully"], language)
            };
    
        } catch (error) {
            console.error("Error sending push notification:", error);
    
            return {
                success: false,
                message: await getSingleTraslateData(["something_went_wrong_while_sending_push_notification"], language),
                error: error.message || error
            };
        }
    },

    sendWindowsToastNotification: async (windowsTokens, message) => {
        try {
            console.log("sendWindowsToastNotification", windowsTokens, message);

            //const userId = "windowsTrayApp";

            const payload = {
                title: "Spillorama Bingo",
                body: message,
                timestamp: Date.now()
            };

            if (firebaseInitialized) {
                windowsTokens.forEach(userId => {
                    admin.database().ref(`notifications/${userId}`).push(payload)
                      .then(() => console.log(`Notification sent to ${userId}`))
                      .catch(err => console.error(`Error sending to ${userId}:`, err));
                });
            } else {
                console.warn('Firebase not initialized — skipping Windows toast notifications');
            }
              
        } catch (error) {
            console.error("Error sending windows toast notification:", error);
        }
    }
}
