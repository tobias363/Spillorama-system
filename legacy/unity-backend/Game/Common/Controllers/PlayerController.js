var Sys = require('../../../Boot/Sys');
var bcrypt = require('bcryptjs');
const moment = require('moment');
var path = require("path");
var fs = require('fs');
var handlebars = require('handlebars');
var jwt = require('jsonwebtoken');
var jwtcofig = {
    'secret': process.env.JWT_SECRET
};

const XmlReader = require('xml-reader');
const xmlQuery = require('xml-query');
// nodemialer to send email
const nodemailer = require('nodemailer');
const f = require('session-file-store');

// create a defaultTransport using gmail and authentication that are
// stored in the `config.js` file.
var defaultTransport = nodemailer.createTransport({
    //service: 'Gmail',
    host: Sys.Config.App.mailer.host,
    port: Sys.Config.App.mailer.port,
    secure: false,
    auth: {
        user: Sys.Config.App.mailer.auth.user,
        pass: Sys.Config.App.mailer.auth.pass
    },
    pool: true,
});
const axios = require('axios');
const { i18next, translate } = require('../../../Config/i18n');
const ExcelJS = require('exceljs');
const config = Sys.Config.App[Sys.Config.Database.connectionType];
const { v4: uuidv4 } = require('uuid');
const { 
    createErrorResponse, 
    createSuccessResponse, 
    getPlayerIp,
    getAvailableHallLimit
} = require('../../../gamehelper/all');
const { 
    validateUserProfilePic,
    randomString,
    picSave,
    processPlayerHall,
    handleDailyAttendance,
    handlePlayerLoginBreakTime,
    playerBlockRules,
    addOrUpdateBlockRule,
    getExistingAndAvailableBlockRules,
    generateUniqueOrderNum,
    handleOfflineDeposit,
    handleOnlineDeposit,
    verifyAndCaptureSwedbankPayment
} = require('../../../gamehelper/player_common');
const { validateAddressData, playerVerificationStatus } = require('../../../gamehelper/game1-process');
const { playerForgotPassTranslation } = require('../../../gamehelper/common');
const { json } = require('body-parser');
module.exports = {

    registerPlayer: async function (req, res) {
        try {
            const {
                username, surname, nickname, phone, email, hall, language = "nor", deviceId, dob, bankId, password,
                os, photoFront = '', photoBack = '', isPEP, residentialAddressInNorway, pepName, pepRelationship,
                pepDateOfBirth, salary, propertySaleOrLease, stocks, socialSupport, giftsOrInheritance, other,
                isResidentialAddressInNorway, // Answer to "Do you have a residential address in Norway? for player"
                city, zipCode, address, country, playBySalary, playByPropertySaleOrLease, playByStocks, playBySocialSupport,
                playByGiftsOrInheritance, playByOther
            } = req.body;
           
            // Early validation checks
            const phoneRegex = /^[0-9]+$/;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (!username) return res.send(await createErrorResponse("username_required", language));
            if (!surname) return res.send(await createErrorResponse("surname_required", language));
            if (!nickname) return res.send(await createErrorResponse("nickname_required", language));
            if (!phone || !phone.match(phoneRegex)) return res.send(await createErrorResponse("phone_required", language));
            if (email && !emailRegex.test(email)) return res.send(await createErrorResponse("invalid_email_format", language));
            

            // Parse hall data once
            const parsedHall = JSON.parse(hall);
            if (!parsedHall?.list?.length) return res.send(await createErrorResponse("select_hall", language));

            // Parallel DB checks for existing user data
            const inputUsername = username.toLowerCase();

            // Build dynamic OR conditions
            const orConditions = [
                { username: inputUsername },
                { phone: inputUsername },
                { phone: phone }
            ];

            // Only push email checks if email exists
            if (email && email.trim() !== '') {
                orConditions.push({ email: email });
            }

            const [existingUser, hallData, customerNumber] = await Promise.all([
               Sys.Game.Game2.Services.PlayerServices.getOneByData({
                    $or: orConditions
                }, {
                    _id: 1, username: 1, email: 1, phone: 1
                }),
                Sys.Game.Common.Services.GameServices.getSingleHallData({ 
                    _id: parsedHall.list[0]._id 
                }),
                module.exports.generateUniqueCustomerNumber()
            ]);

            if (existingUser) {
                let messageKey;
                if (existingUser.username === inputUsername || existingUser.email === inputUsername || existingUser.phone === inputUsername) {
                    messageKey = "username_exists";
                } else if (existingUser.phone === phone) {
                    messageKey = "phone_exists";
                } else if (email && existingUser.email === email) {
                    messageKey = "email_exists";
                }
                return res.send(await createErrorResponse(messageKey, language));
            }
            
            // PEP validation
            const isPEPBool = typeof isPEP === 'string' ? isPEP.toLowerCase() === 'true' : isPEP;
            if (isPEPBool) {
                const hasValidPEPDetails = 
                    residentialAddressInNorway !== undefined &&
                    pepName &&
                    pepRelationship &&
                    pepDateOfBirth &&
                    (salary?.toLowerCase() === 'true' ||
                    propertySaleOrLease?.toLowerCase() === 'true' ||
                    stocks?.toLowerCase() === 'true' ||
                    socialSupport?.toLowerCase() === 'true' ||
                    giftsOrInheritance?.toLowerCase() === 'true' ||
                    other?.toLowerCase() === 'true');

                if (!hasValidPEPDetails) return res.send(await createErrorResponse("pep_fields_are_required", language));
            }

            const validationResult = validateAddressData({isResidentialAddressInNorway, city, zipCode, address, country, incomeSources: { playBySalary, playByPropertySaleOrLease, playByStocks, playBySocialSupport, playByGiftsOrInheritance, playByOther } });
            if (!validationResult.isValid && validationResult.error) {
                return res.send({
                    status: 'fail', result: null, message: await translate({ key: validationResult.error, language: language }), statusCode: 400
                });
            } 

            // Process profile pictures in parallel
            let profilePic = [];
            try {
                profilePic = await Promise.all([
                    validateUserProfilePic(photoFront),
                    validateUserProfilePic(photoBack)
                ]);
            } catch (err) {
                return res.send(await createErrorResponse(err.message, language));
            }

            // Create player object
            const playerObj = {
                device_id: deviceId,
                username: username.toLowerCase(),
                email,
                phone,
                nickname: nickname.toLowerCase(),
                dob,
                walletAmount: 0,
                points: 0,
                bankId,
                hall: {
                    id: hallData.id.toString(),
                    name: hallData.name,
                    status: 'Pending'
                },
                profilePic,
                password: bcrypt.hashSync(password, 10),
                socketId: '1234',
                platform_os: os,
                HR: "yes",
                PEP: isPEPBool ? "yes" : "no",
                surname: surname.toLowerCase(),
                customerNumber: customerNumber.newCustomerNumber,
                approvedHalls: [{
                    status: "Pending",
                    id: hallData.id.toString(),
                    name: hallData.name,
                    groupHall: hallData.groupHall,
                }],
                pepDetails: isPEPBool ? {
                    residentialAddressInNorway: residentialAddressInNorway?.toLowerCase() === 'true',
                    name: pepName,
                    relationship: pepRelationship,
                    dateOfBirth: new Date(pepDateOfBirth),
                    incomeSources: {
                        salary: salary?.toLowerCase() === 'true', 
                        propertySaleOrLease: propertySaleOrLease?.toLowerCase() === 'true',
                        stocks: stocks?.toLowerCase() === 'true',
                        socialSupport: socialSupport?.toLowerCase() === 'true',
                        giftsOrInheritance: giftsOrInheritance?.toLowerCase() === 'true',
                        other: other?.toLowerCase() === 'true'
                    },
                } : undefined,
                riskCategory: "Low",
                addressDetails: validationResult.addressDetails,
                selectedLanguage: language
            };

            const player = await Sys.Game.Common.Services.PlayerServices.create(playerObj);

            if (!player) return res.send(await createErrorResponse("player_not_created", language));

            let responseData = { playerId: player._id.toString(), username: player.username };
            if (String(isPEP).toLowerCase() === 'true' || String(isResidentialAddressInNorway).toLowerCase() !== 'true') {
                return res.send(await createSuccessResponse(responseData, "registration_request_pep_non_residential", language, true, false));
            } else {
                return res.send(await createSuccessResponse(responseData, "registration_request", language, true, true, { number: hallData.name }));
            }
           
        } catch (error) {
            console.error("Registration error:", error);
            return res.send(await createErrorResponse("something_went_wrong", req.body.language || "nor"));
        }
    },

    playerLogin: async function (socket, data) {
        try {
            const {
                language = "nor", password, os, appVersion, name, forceLogin, deviceId, firebaseToken
            } = data;

            let { hallId } = data;

            let loginResult = { storeUrl: "", message: "", disable_store_link: true, playerId: "", hall: "", hallName: "", points: 0, realMoney: 0 }

            // Early validation for required fields
            if (!password?.trim()) { //|| !hallId?.trim()
                return await createErrorResponse("incorrect_username_or_password", language, 401, true, null, loginResult);
            }

            // App version validation
            if (!os || !appVersion) {
                return await createErrorResponse("update_app", language, 401, true, null, loginResult);
            }

            // Version check
            const isValidVersion = (
                (os === 'android' && appVersion >= Sys.Setting.android_version) ||
                (os === 'iOS' && appVersion >= Sys.Setting.ios_version) ||
                ((os === 'windows' || os === 'other') && appVersion >= Sys.Setting.wind_linux_version) ||
                (os === 'webgl' && appVersion >= Sys.Setting.webgl_version)
            );

            if (!isValidVersion) {
                const storeUrls = {
                    android: Sys.Setting.android_store_link,
                    iOS: Sys.Setting.ios_store_link,
                    windows: Sys.Setting.windows_store_link,
                    webgl: Sys.Setting.webgl_store_link
                };
                loginResult.storeUrl = Sys.Setting.disable_store_link === "No" ? (storeUrls[os] || storeUrls.windows) : "";
                loginResult.disable_store_link = Sys.Setting.disable_store_link === "Yes";
                loginResult.message = await translate({ key: "update_app", language: language });
                return await createErrorResponse("updateApp", language, 401, false, null, loginResult);
            }

            if (!name) {
                return await createErrorResponse("enter_username_phone", language, 400, true, null, loginResult);
            }

            // Prepare player query
            const playerQuery = {
                isDeleted: false,
                '$or': [
                    { username: name.toLowerCase() },
                    { phone: name.toLowerCase() }
                ]
            };

            // get player and hall based ip in parallel
            const [player, hallBasedIp] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getOneByData(playerQuery, { status: 1, password: 1, userType: 1, hall: 1, points: 1, walletAmount: 1, selectedLanguage: 1, bankIdAuth: 1, isVerifiedByHall: 1, isVerifiedByBankID: 1, approvedHalls: 1, socketId: 1 }),
                Sys.App.Services.HallServices.getSingleHallData(
                    { ip: getPlayerIp({ handshake: { headers: socket.handshake.headers }, conn: { remoteAddress: socket.conn.remoteAddress }}) },
                    { name: 1, groupHall: 1 }
                )
            ]);

            if (!player) {
                return await createErrorResponse("wrong_unam_phone_name", language, 400, true, null, loginResult);
            }
            loginResult.playerId = player._id.toString();
            // Bot check
            if (player.userType === "Bot") {
                return await createErrorResponse("cant_login", language, 400, true, null, loginResult);
            }

            // Status checks
            if (player.status === 'Blocked' || player.status === 'Inactive') {
                return await createErrorResponse(player.status === 'Blocked' ? "blocked" : "inactive_players", language, 400, true, null, loginResult);
            }

            // Password check
            if (!bcrypt.compareSync(password, player.password)) {
                return await createErrorResponse("incorrect_username_or_password", language, 401, true, null, loginResult);
            }

            if(!hallId?.trim()){
                if (hallBasedIp && hallBasedIp._id) {
                    hallId = hallBasedIp._id.toString();
                } else if (Array.isArray(player?.approvedHalls) && player.approvedHalls.length > 0) {
                    const firstApproved = player.approvedHalls.find(h => h.status === 'Approved');
                    hallId = firstApproved ? firstApproved.id : hallId;
                }
                console.log("If hallId is not passed then this is the default hall selected---", hallId);
            }

            // Hall validation and processing
            const hallResult = await processPlayerHall(player, hallId, hallBasedIp);
            if (!hallResult.success) {
                if(hallResult?.error?.isDynamic){
                    return await createErrorResponse(hallResult.error.key, language, 400, true, null, loginResult, true, hallResult.error.numbers);
                }
                return await createErrorResponse(hallResult.error.key, language, 400, true, null, loginResult);
            }

            const currentHall = hallResult.hall;
            const currentGroupHall = hallResult.groupHall;
           
            // Handle forcelogin and is already logged in
            console.log("login details", forceLogin, player.socketId, socket.id);
            if (forceLogin) {
                if (player.socketId != socket.id) {
                    console.log("Client Log in and Reconnection issue 2", player.socketId);
                    await Sys.Io.to(player.socketId).emit('ForceLogout', {
                        playerId: player._id.toString(),
                        message: await translate({ key: "logout_as_login", language: language }),
                    });
                }
            }else{
                console.log("Sys.ConnectedPlayers", Sys.ConnectedPlayers, player.socketId, socket.id)
                if (( Sys.Io.sockets.connected[player.socketId] || (Sys.ConnectedPlayers[player._id.toString()] && Sys.ConnectedPlayers[player._id.toString()].deviceId !== deviceId && Sys.ConnectedPlayers[player._id.toString()].status == "Online") ) && player.socketId != socket.id) {
                    console.log("socket is already connected");
                    return await createErrorResponse("alreadyLogin", language, 400, false, null, loginResult);
                }
            } 
    
            // Generate auth token and update player data in parallel
            const [authToken, refreshAuthToken] = await Promise.all([
                generateAuthToken(player._id, '1d', jwtcofig.secret),
                generateAuthToken(player._id, '7d', process.env.JWT_REFRESH_SECRET),
                handleDailyAttendance(player),
                handlePlayerLoginBreakTime(player)
            ]);

            // Update player session
            const updatedPlayer = await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({
                _id: player._id
            }, {
                socketId: socket.id,
                firebaseToken: firebaseToken,
                platform_os: os,
                device_id: deviceId,
                selectedLanguage: (!player.selectedLanguage) ? language : player.selectedLanguage,
                hall: currentHall,
                groupHall: currentGroupHall,
                'otherData.authToken': authToken,  // authToken will be used to verify user when api call from unity side     
                'otherData.refreshAuthToken': refreshAuthToken,
                'otherData.isSoundOn': 0, //0: false, 1: true
                'otherData.isVoiceOn': 0, //0: false, 1: true
                'otherData.selectedVoiceLanguage': 0  //0: norway_men, 1: norway_women, 2: english
            }, {new: true});

            // Update connected players cache
            Sys.ConnectedPlayers[player._id.toString()] = {
                socketId: socket.id,
                deviceId: deviceId,
                status: "Online"
            };
            console.log("Sys.ConnectedPlayers", Sys.ConnectedPlayers, updatedPlayer)
            // Update socket language
            socket.languageData = (!player.selectedLanguage) ? language : player.selectedLanguage;

            // Add canPlayGames for verified players and verificationType
            const isVerifiedByBankID = player?.bankIdAuth && Object.keys(player?.bankIdAuth).length > 0 && player?.bankIdAuth.status === "COMPLETED";
            const isVerifiedByHall = player?.isVerifiedByHall;
            const canPlayGames = player?.isAlreadyApproved || isVerifiedByBankID || isVerifiedByHall;
            
            const approvedHalls = await getAvailableHallLimit({ playerId: player._id, approvedHalls: updatedPlayer?.approvedHalls, selectedHallId: currentHall.id });
           
            // Return success response
            return createSuccessResponse({ storeUrl: "", message: "", disable_store_link: true, playerId: player._id.toString(), hall: currentHall.id, hallName: currentHall.name, points: player.points, realMoney: player.walletAmount.toFixed(2), selectedLanguage: player.selectedLanguage, screenSaver: Sys.Setting.screenSaver, screenSaverTime: Sys.Setting.screenSaverTime, imageTime: Sys.Setting.imageTime, authToken, refreshAuthToken, canPlayGames: canPlayGames, isVerifiedByBankID: isVerifiedByBankID, isVerifiedByHall: isVerifiedByHall, approvedHalls: approvedHalls, isSoundOn: 0, isVoiceOn: 0, selectedVoiceLanguage: 0 }, "Player Successfully Login!", language, false,);

        } catch (error) {
            console.error('Login Error:', error);
            return await createErrorResponse("something_went_wrong", language, 400, true, null, { storeUrl: "", message: "", disable_store_link: true, playerId: "", hall: "", hallName: "", points: 0, realMoney: 0 });
        }
    },

    playerDetails: async function (socket, data) {
        try {
            const { playerId } = data;
           
            if (!playerId) {
                return await createErrorResponse("something_went_wrong", socket.languageData, 400, true);
            }
            // Get player details
            const player = await Sys.Game.Game2.Services.PlayerServices.getOneByData({ _id: playerId }, { hall: 1, points: 1, walletAmount: 1 });

            if (!player) {
                return await createErrorResponse("player_not_found", socket.languageData, 400, true);
            }

            // Return success response with player details
            return await createSuccessResponse(
                {
                    playerId: player._id.toString(),
                    hall: player.hall.id,
                    hallName: player.hall.name,
                    points: player.points,
                    realMoney: player.walletAmount.toFixed(2)
                },
                "Player Details Found", socket.languageData, false
            );

        } catch (error) {
            console.error("Error in playerDetails:", error);
            return await createErrorResponse("internal_server_error", socket.languageData, 500, true);
        }
    },

    playerLogout: async function (socket, data) {
        try {
            const { playerId } = data;
            if (!playerId) {
                return await createErrorResponse("something_went_wrong", socket.languageData, 400, true);
            }

            // Get player and update in parallel
            const updateResult = await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
                { _id: playerId }, { socketId: '' }, { new: true }
            )
           
            if (!updateResult) {
                return await createErrorResponse("player_not_found", socket.languageData, 400, true);
            }

            // Remove from connected players cache if exists
            const playerIdString = updateResult._id.toString();
            if (Sys.ConnectedPlayers[playerIdString]) {
                delete Sys.ConnectedPlayers[playerIdString];
            }

            return await createSuccessResponse( null, "Logout Successfully..!!", socket.languageData, false);

        } catch (error) {
            console.error('Error in Logout Player:', error);
            return await createErrorResponse("something_went_wrong", socket.languageData, 500, true);
        }
    },

    selectLuckyNumber: async function (socket, data) {
        try {
            const { playerId, luckyNumber, isLuckyNumberEnabled } = data;
            
            // Early validation
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", socket.languageData, 400, true);
            }
           
            // Prepare update data
            const updateData = {
                isLuckyNumberEnabled
            };

            // Only add luckyNumber if it's provided
            if (luckyNumber !== null) {
                updateData.luckyNumber = luckyNumber;
            }

            // Update player data
            const updatedResult = await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
                { _id: playerId }, updateData
            );

            if (!updatedResult) {
                return await createErrorResponse("player_not_found", socket.languageData, 400, true);
            }

            // Return success response
            return await createSuccessResponse( null, "Lucky number data updated Successfully!", socket.languageData, false);
            
        } catch (error) {
            console.error("Error in selectLuckyNumber:", error);
            return await createErrorResponse("something_went_wrong", socket.languageData, 500, true);
        }
    },

    getLuckyNumber: async function (socket, data) {
        try {
            const { playerId } = data;
            
            // Early validation
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", socket.languageData, 400, true);
            }

            // Get player data with minimal fields
            const player = await Sys.Game.Game2.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { isLuckyNumberEnabled: 1, luckyNumber: 1 }
            );

            if (!player) {
                return await createErrorResponse("player_not_found", socket.languageData, 400, true);
            }

            // Return success response
            return createSuccessResponse(
                {
                    isLuckyNumberEnabled: (player.isLuckyNumberEnabled == null) ? false : player.isLuckyNumberEnabled,
                    luckyNumber: player.luckyNumber
                },
                "Lucky number data!", socket.languageData, false
            );

        } catch (error) {
            console.error("Error in getLuckyNumber:", error);
            return await createErrorResponse("something_went_wrong", socket.languageData, 500, true);
        }
    },

    setLimit: async function (socket, data) {
        try {
            const { playerId, limit } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId }, {_id: 1}
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const isLimitEnabled = limit > 0;
    
            await Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: playerId },
                {
                    monthlyWallet: isLimitEnabled,
                    monthlyWalletAmountLimit: isLimitEnabled ? limit : 0
                }
            );
    
            return {
                status: 'success',
                message: 'Monthly Wallet Limit updated!'
            };
    
        } catch (error) {
            console.error("Error setLimit", error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    VoucherList: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId }, {_id: 1}
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const currentDate = new Date();
    
            const vouchers = await Sys.App.Services.VoucherServices.voucherData({
                status: "active",
                expiryDate: { $gte: currentDate }
            });
    
            // Process vouchers in parallel
            const formattedVouchers = await Promise.all(
                vouchers.map(async (voucher) => {
                    const transactionCount =
                        await Sys.Game.Common.Services.PlayerServices.transactionCountData({
                            voucherId: voucher._id,
                            playerId
                        });
    
                    return {
                        id: voucher._id,
                        percentageOff: voucher.percentageOff,
                        redeemPoints: Number(voucher.points),
                        redeemed: transactionCount > 0,
                        expiryDate: await Sys.Helper.bingo.gameFormateTime(voucher.expiryDate)
                    };
                })
            );
    
            return {
                status: 'success',
                result: formattedVouchers,
                message: 'Voucher list fetched successfully'
            };
    
        } catch (error) {
            console.error("Error VoucherList", error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    // [ Redeem Voucher ]
    RedeemVoucher: async function (socket, data) {
        try {
            const { playerId, voucherId } = data;
            const { languageData } = socket;
    
            /* -------------------- Player Validation -------------------- */
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId }, {_id: 1, selectedLanguage: 1, username: 1, email: 1, phone: 1}
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            /* -------------------- Voucher Already Used -------------------- */
            const alreadyPurchased = await Sys.Game.Common.Services.PlayerServices.transactionData({
                voucherId,
                playerId,
                isVoucherUse: true,
                isVoucherApplied: true
            });
    
            if (alreadyPurchased.length > 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "voucher_already_purchased",
                        language: player.selectedLanguage
                    }),
                    statusCode: 400
                };
            }
    
            /* -------------------- Voucher Validation -------------------- */
            const voucher = await Sys.App.Services.VoucherServices.getById(voucherId);
            if (!voucher) {
                return {
                    status: 'fail',
                    message: 'Voucher not found',
                    statusCode: 400
                };
            }
    
            /* -------------------- Voucher Code Generator -------------------- */
            const generateVoucherCode = () =>
                Array.from({ length: 4 }, () =>
                    Math.random().toString(36).substring(2, 6).toUpperCase()
                ).join('-');
    
            const voucherCode = generateVoucherCode();
    
            /* -------------------- Create Transaction -------------------- */
            await Sys.Helper.gameHelper.createTransactionPlayer({
                playerId,
                voucherId: voucher._id,
                voucherCode,
                transactionSlug: "voucher",
                action: "debit",
                purchasedSlug: "points",
                totalAmount: voucher.points
            });
    
            /* -------------------- Date Formatting -------------------- */
            const formatDate = (date) => {
                const d = new Date(date);
                const hours = d.getHours() % 12 || 12;
                const minutes = d.getMinutes().toString().padStart(2, '0');
                const ampm = d.getHours() >= 12 ? 'pm' : 'am';
                return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hours}:${minutes} ${ampm}`;
            };
    
            const expiryDateFormatted = formatDate(voucher.expiryDate);
            const expiryDateTxn = await Sys.Helper.bingo.dateTimeFunctionTransactionHistory(
                voucher.expiryDate
            );
    
            /* -------------------- Email -------------------- */
            const emailData = {
                uname: player.username,
                msg: 'We Have Sent You this Email in Response to Your Purchased this Voucher Code.',
                code: voucherCode,
                note: "This Code Only One Time Use then after It'll be Invalid for Further Process",
                baseUrl: Sys.Config.App.baseUrl.developementUrl,
                date: expiryDateFormatted,
                date2: expiryDateTxn
            };
    
            const templatePath = path.join(
                __dirname,
                '../../../App/Views/templateHtml/email/email.html'
            );
    
            const template = handlebars.compile(
                fs.readFileSync(templatePath, 'utf-8')
            );
    
            defaultTransport.sendMail({
                from: Sys.Config.App.mailer.defaultFromAddress,
                to: player.email,
                subject: 'Spillorama Bingo Game: Voucher Details',
                html: template(emailData)
            });
    
            /* -------------------- SMS -------------------- */
            const user = await Sys.App.Services.UserServices.getSingleUserData(
                {},
                { smsUsername: 1, smsPassword: 1 }
            );
    
            const smsMessage =
                `Spillorama Bingo Game\n` +
                `Voucher Code: ${voucherCode}\n` +
                `Valid until: ${expiryDateFormatted}\n` +
                `This code can be used only once.`;
    
            require('request')(
                `https://sveve.no/SMS/SendMessage?user=${user.smsUsername}&passwd=${user.smsPassword}&to=${player.phone}&msg=${encodeURIComponent(smsMessage)}`
            );
    
            /* -------------------- Success -------------------- */
            return {
                status: 'success',
                message: await translate({
                    key: "voucher_purchase_success",
                    language: player.selectedLanguage
                })
            };
    
        } catch (error) {
            console.error("Error RedeemVoucher", error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    playerNotifications: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const notificationsData =
                await Sys.Game.Common.Services.NotificationServices.getByData({
                    playerId
                });
    
            const resolveTextByLanguage = (text) =>
                typeof text === 'object' && text !== null
                    ? text[player.selectedLanguage]
                    : text;
    
            const notifications = notificationsData.map((item) => {
                const { notification, createdAt } = item;
    
                const response = {
                    notificationType: notification.notificationType,
                    notificationDateAndTime: createdAt,
                    message: resolveTextByLanguage(notification.message)
                };
    
                if (
                    notification.notificationType === 'purchasedTickets' ||
                    notification.notificationType === 'cancelTickets'
                ) {
                    response.ticketMessage = resolveTextByLanguage(
                        notification.ticketMessage
                    );
                    response.price = notification.price;
                    response.date = moment(notification.date).utc();
                }
    
                return response;
            });
    
            return {
                status: 'success',
                result: notifications,
                message: "Player notifications fetched successfully"
            };
    
        } catch (error) {
            console.error("Error in playerNotifications", error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    // [ Player Delete Account ]
    deletePlayerAccount: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }

            await Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: playerId },
                {
                    isDeleted: true 
                }
            );
        
            return {
                status: 'success',
                message: 'Account deleted successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in deletePlayerAccount:', error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    reconnectPlayer: async function (socket, data) {
        try {
            const { playerId, deviceId } = data;
    
            if (!playerId) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Player Reconnect Failed!'
                };
            }
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                {
                    socketId: 1,
                    device_id: 1,
                    selectedLanguage: 1,
                    bankIdAuth: 1,
                    isVerifiedByHall: 1,
                    isAlreadyApproved: 1
                }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Player not found'
                };
            }
    
            socket.languageData = player.selectedLanguage;
    
            const existingSocket =
                player.socketId && Sys.Io.sockets.connected?.[player.socketId];
    
            const isDifferentDevice =
                existingSocket &&
                player.device_id !== deviceId &&
                player.socketId !== socket.id;
    
            if (isDifferentDevice) {
                const message = await translate({
                    key: "logout_as_login",
                    language: player.selectedLanguage
                });
    
                await Sys.Io.to(socket.id).emit('ForceLogout', {
                    playerId: player._id.toString(),
                    message
                });
    
                return {
                    status: 'logout',
                    result: null,
                    message
                };
            }
    
            /* -------------------- Update Connected Players -------------------- */
            const connectedPlayer =
                Sys.ConnectedPlayers[playerId] || {};
    
            Sys.ConnectedPlayers[playerId] = {
                ...connectedPlayer,
                socketId: socket.id,
                deviceId,
                status: "Online"
            };
    
            /* -------------------- Update Player Socket -------------------- */
            await Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: playerId },
                {
                    socketId: socket.id,
                    device_id: deviceId
                }
            );
    
            /* -------------------- Verification Status -------------------- */
            const isVerifiedByBankID =
                player.bankIdAuth?.status === "COMPLETED";
    
            const isVerifiedByHall = !!player.isVerifiedByHall;
    
            const canPlayGames =
                player.isAlreadyApproved ||
                isVerifiedByBankID ||
                isVerifiedByHall;
    
            return {
                status: 'success',
                result: {
                    canPlayGames,
                    isVerifiedByBankID,
                    isVerifiedByHall
                },
                message: 'Player reconnected successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in reconnectPlayer:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong'
            };
        }
    },

    updateProfile: async function (socket, data) {
        try {
            const {
                playerId,
                username,
                nickname,
                phone,
                email,
                bankId,
                profilePic,
                surname
            } = data;
    
            const { languageData } = socket;
    
            /* -------------------- Player Check -------------------- */
            const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { username: 1, email: 1, phone: 1, selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const language = player.selectedLanguage;
    
            /* -------------------- Bank Validation -------------------- */
            if (!bankId) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "provide_valid_bank",
                        language
                    })
                };
            }

            if (!username) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "username_required",
                        language
                    })
                };
            }

            if (!phone) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "phone_required",
                        language
                    })
                };
            }
    
            /* -------------------- Username Validation -------------------- */
            if (username && username.toLowerCase() !== player.username) {
                const exists = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({
                    _id: { $ne: player._id },
                    $or: [
                        { username: username.toLowerCase() },
                        { email: username.toLowerCase() },
                        { phone: username.toLowerCase() }
                    ]
                });
    
                if (exists) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "username_exists",
                            language
                        })
                    };
                }
            }
    
            /* -------------------- Email Validation -------------------- */
            if (email && email !== player.email) {
                 
                // Validate email format
                const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
                if (!isValidEmail) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "invalid_email_format",
                            language
                        })
                    };
                }
                const exists = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({
                    email
                });
    
                if (exists) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "email_exists",
                            language
                        })
                    };
                }
            }
    
            /* -------------------- Phone Validation -------------------- */
            if (phone && phone !== player.phone) {
                const phoneRegex = /^[0-9]+$/;
    
                if (!phoneRegex.test(phone)) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "phone_required",
                            language
                        })
                    };
                }
    
                const exists = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({
                    phone
                });
    
                if (exists) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "phone_exists",
                            language
                        })
                    };
                }
            }
    
            /* -------------------- Update Object -------------------- */
            const updateData = {
                username: username?.toLowerCase(),
                nickname: nickname?.toLowerCase(),
                phone,
                email,
                bankId,
                surname
            };
    
            /* -------------------- Profile Picture -------------------- */
            if (profilePic) {
                const fs = require('fs');
                const randomNum = Math.floor(100000 + Math.random() * 900000);
    
                const extMap = {
                    '/': 'jpg',
                    'i': 'png'
                };
    
                const extension = extMap[profilePic.charAt(0)];
    
                if (!extension) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: "file_invalid",
                            language
                        }),
                        statusCode: 400
                    };
                }
    
                const imgData = profilePic.replace(/^imgData:image\/\w+;base64,/, "");
                const buffer = Buffer.from(imgData, 'base64');
    
                const filePath = `public/assets/profilePic/${playerId}_${randomNum}.${extension}`;
    
                fs.writeFileSync(filePath, buffer);
    
                updateData.userProfilePic =
                    `/assets/profilePic/${playerId}_${randomNum}.${extension}`;
            }
    
            /* -------------------- Update Player -------------------- */
            const updated = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId },
                updateData
            );
    
            if (!updated) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "profile_update_failed",
                        language
                    }),
                    statusCode: 400
                };
            }
    
            return {
                status: 'success',
                message: await translate({
                    key: "profile_update_success",
                    language
                })
            };
    
        } catch (error) {
            Sys.Log.error('Error in updateProfile:', error);
            return {
                status: 'fail',
                message: 'Something went wrong'
            };
        }
    },
    
    gameTypeData: async function (socket, data) {
        try {
            const { languageData } = socket;
    
            const gameList = await Sys.Game.Common.Services.GameServices.getListData({}, {name: 1, photo: 1});
    
            if (gameList.length === 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "something_went_wrong",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const baseUrl =
                Sys.Config.App[Sys.Config.Database.connectionType].url;
    
            const gameType = gameList.map(game => ({
                name: game.name,
                photo: `${baseUrl}profile/bingo/${game.photo}`
            }));
            
            return {
                status: 'success',
                result: { gameType },
                message: 'Game Type Sent Successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in gameTypeData:', error);
    
            return {
                status: 'fail',
                result: null,
                message: await translate({
                    key: "something_went_wrong",
                    language: socket.languageData
                }),
                statusCode: 400
            };
        }
    },
    
    EnableNotification: async function (socket, data) {
        try {
            const { playerId, flag } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            const updatedPlayer =
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: playerId },
                    { enableNotification: flag },
                );
    
            if (!updatedPlayer) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "profile_update_failed",
                        language: player.selectedLanguage
                    }),
                    statusCode: 400
                };
            }
    
            return {
                status: 'success',
                result: {},
                message: flag
                    ? 'Notification enabled successfully!'
                    : 'Notification disabled successfully!'
            };
    
        } catch (error) {
            Sys.Log.error('Error in EnableNotification:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    // This functionality is replaced by other block module
    // BlockMySelf: async function (socket, data) {
    //     try {
    //         const { playerId, days } = data;
    //         const { languageData } = socket;
    
    //         const blockDays = Number(days);
        
    //         const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
    //             { _id: playerId },
    //             { selectedLanguage: 1 }
    //         );
    
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({
    //                     key: "player_not_found",
    //                     language: languageData
    //                 }),
    //                 statusCode: 400
    //             };
    //         }
    
    //         const blockedTime =
    //             blockDays === 0
    //                 ? null
    //                 : new Date(Date.now() + blockDays * 24 * 60 * 60 * 1000);
    
    //         const updateData = {
    //             blockedTime,
    //             status: blockDays === 0 ? 'Active' : 'Blocked'
    //         };
    
    //         const updatedPlayer =
    //             await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
    //                 { _id: playerId },
    //                 updateData,
    //             );
    
    //         if (!updatedPlayer) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({
    //                     key: "profile_update_failed",
    //                     language: player.selectedLanguage
    //                 }),
    //                 statusCode: 400
    //             };
    //         }
    
    //         return {
    //             status: 'success',
    //             result: {},
    //             message: await translate({
    //                 key: blockDays === 0 ? "unblock_success" : "block_success",
    //                 language: player.selectedLanguage
    //             })
    //         };
    
    //     } catch (error) {
    //         Sys.Log.error('Error in BlockMySelf:', error);
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: 'Something went wrong',
    //             statusCode: 500
    //         };
    //     }
    // },
    
    playerProfile: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                {
                    email: 1,
                    username: 1,
                    nickname: 1,
                    dob: 1,
                    phone: 1,
                    bankId: 1,
                    userProfilePic: 1,
                    walletAmount: 1,
                    points: 1,
                    hall: 1,
                    profilePic: 1,
                    surname: 1,
                    customerNumber: 1,
                    selectedLanguage: 1
                }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            // Get verification flags
            const {
                isVerifiedByBankID,
                isVerifiedByHall,
                isBankIdReverificationNeeded,
                idExpiryDate
            } = await playerVerificationStatus(player);
    
            return {
                status: 'success',
                result: {
                    playerId: player._id,
                    email: player.email,
                    username: player.username,
                    nickname: player.nickname,
                    dob: player.dob,
                    mobile: player.phone,
                    bankId: player.bankId,
                    profilePic: player.userProfilePic || "/assets/profilePic/gameUser.jpg",
                    realMoney: Number(player.walletAmount || 0).toFixed(2),
                    points: Number(player.points || 0).toFixed(2),
                    hall: player.hall,
                    frontId: player.profilePic?.[0] || "",
                    backId: player.profilePic?.[1] || "",
                    surname: player.surname,
                    customerNumber: player.customerNumber,
                    isVerifiedByBankID,
                    isVerifiedByHall,
                    isBankIdReverificationNeeded,
                    idExpiryDate
                },
                message: 'Player Data Found'
            };
    
        } catch (error) {
            Sys.Log.error('Error in playerProfile:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    getApprovedHallList: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;

            const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { userType: 1, groupHall: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            let hallList = [];
    
            // Unique user → access to all halls
            if (player.userType === "Unique") {
                const allHalls = await Sys.App.Services.HallServices.getAllHallDataSelect(
                    {},
                    { name: 1 }
                );
    
                hallList = allHalls.map(hall => hall.name);
    
            } 
            // Normal user → only approved group hall
            else {
                const { groupHall } = player;
    
                if (
                    groupHall &&
                    groupHall.status === "Approved" &&
                    groupHall.hallName
                ) {
                    hallList.push(groupHall.hallName);
                }
            }
    
            return {
                status: 'success',
                result: hallList,
                message: 'Player hall list found successfully!'
            };
    
        } catch (error) {
            Sys.Log.error('Error in getApprovedHallList:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    updateFirebaseToken: async function (socket, data) {
        try {
            const { playerId, firebaseToken } = data;
            const { languageData } = socket;
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { _id: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language: languageData
                    }),
                    statusCode: 400
                };
            }
    
            await Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: playerId },
                { firebaseToken }
            );
    
            return {
                status: 'success',
                result: {},
                message: "Player Firebase token updated successfully"
            };
    
        } catch (error) {
            Sys.Log.error('Error in updateFirebaseToken:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },

    faq: async function (socket, data) {
        try {
            const { slug } = data;
    
            if (slug !== 'faq') {
                return {
                    status: 'fail',
                    result: null,
                    message: 'FAQ details not found',
                    statusCode: 400
                };
            }
    
            const columns = ['queId', 'question', 'answer'];
    
            const faqList = await Sys.Game.Common.Services.cmsServices.faqGetByData(
                {},
                columns
            );
    
            return {
                status: 'success',
                result: faqList || [],
                message: 'FAQ details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in faq API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    terms: async function (socket, data) {
        try {
            const { slug } = data;
    
            const cmsData = await Sys.Game.Common.Services.cmsServices.getCmsByData({}, {terms: 1});
    
            if (!cmsData?.terms || cmsData?.terms?.slug !== slug) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Terms details not found',
                    statusCode: 400
                };
            }
    
            const { title, description } = cmsData?.terms;
    
            return {
                status: 'success',
                result: { title, description },
                message: 'Terms details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in terms API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    support: async function (socket, data) {
        try {
            const { slug } = data;
    
            const cmsData = await Sys.Game.Common.Services.cmsServices.getCmsByData({}, {support: 1});
    
            if (!cmsData?.support || cmsData?.support?.slug !== slug) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Support details not found',
                    statusCode: 400
                };
            }
    
            const { title, description } = cmsData?.support;
    
            return {
                status: 'success',
                result: { title, description },
                message: 'Support details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in support API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },

    aboutUs: async function (socket, data) {
        try {
            const { slug } = data;
    
            const cmsData = await Sys.Game.Common.Services.cmsServices.getCmsByData({}, { aboutus: 1 });
    
            if (!cmsData?.aboutus || cmsData?.aboutus?.slug !== slug) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'About Us details not found',
                    statusCode: 400
                };
            }
    
            const { title, description } = cmsData.aboutus;
    
            return {
                status: 'success',
                result: { title, description },
                message: 'About Us details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in aboutUs API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    responsibleGameing: async function (socket, data) {
        try {
            const { slug } = data;
    
            const cmsData = await Sys.Game.Common.Services.cmsServices.getCmsByData({}, { responsible_gameing: 1 });
    
            if (!cmsData?.responsible_gameing || cmsData?.responsible_gameing?.slug !== slug) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Responsible Gaming details not found',
                    statusCode: 400
                };
            }
    
            const { title, description } = cmsData?.responsible_gameing;
    
            return {
                status: 'success',
                result: { title, description },
                message: 'Responsible Gaming details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in responsibleGameing API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    links: async function (socket, data) {
        try {
            const { slug } = data;
    
            const cmsData = await Sys.Game.Common.Services.cmsServices.getCmsByData({}, { links: 1 });
    
            if (!cmsData?.links || cmsData?.links?.slug !== slug) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Links details not found',
                    statusCode: 400
                };
            }
    
            const { title, description } = cmsData?.links;
    
            return {
                status: 'success',
                result: { title, description },
                message: 'Links details fetched successfully'
            };
    
        } catch (error) {
            Sys.Log.error('Error in links API:', error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    TransactionHistory: async function (socket, data) {
        try {
            const { playerId } = data;

            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { selectedLanguage: 1, _id: 1 }
            );

            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'No Player Found!',
                    statusCode: 400
                };
            }
    
            const { _id, selectedLanguage } = player;
    
            const transactions =
                await Sys.Game.Common.Services.PlayerServices.getTransactionByData(
                    {
                        playerId: _id,
                        $or: [
                            { defineSlug: "extraTransaction" },
                            { defineSlug: "patternPrizeGame1" },
                            { defineSlug: "jackpotPrizeGame1" },
                            { defineSlug: "WOFPrizeGame1" },
                            { defineSlug: "TChestPrizeGame1" },
                            { defineSlug: "mystryPrizeGame1" },
                            { defineSlug: "luckyNumberPrizeGame1" },
                            { defineSlug: "mysteryPrizeGame1" },
                            { defineSlug: "colordraftPrizeGame1" },
                            { defineSlug: "patternPrize" }
                        ]
                    },
                    {
                        category: 1,
                        typeOfTransaction: 1,
                        typeOfTransactionTotalAmount: 1,
                        transactionId: 1,
                        amtCategory: 1,
                        status: 1,
                        createdAt: 1,
                        depositType: 1
                    },
                    {
                        sort: { createdAt: -1 },
                        limit: 100
                    }
                );
    
            const norTranslationMap = {
                "Game Joined": "Spillet ble med",
                "Deposit": "Innskudd",
                "Lucky Number Price.": "Lucky Number Pris.",
                "Refund": "Refusjon",
                "Game Join/Ticket Purchase": "Spill delta/billettkjøp",
                "Lucky number prize": "Lykkenummer premie",
                "Game Won Price": "Spill vunnet pris",
                "Game Won": "Spill vunnet",
                "Withdraw in Hall": "Trekk tilbake i Hall",
                "Withdraw in Bank": "Ta ut i banken",
                "Replaced Tickets": "Erstattede billetter",
                "Color Draft Prize": "Color Draft Premie",
                "Pattern Prize": "Mønsterpris",
                "Pattern Price": "Mønsterpris",
                "Treasure Chest Prize": "Treasure Chest Premie",
                "Leaderboard Price": "Leaderboard Pris",
                "Cancel Ticket": "Kanseller billett",
                "Cancel Tickets": "Kanseller billetter",
                "Deposit By Pay in Hall": "Innskudd ved lønn i hallen",
                "Game 5 Jackpot's Prize": "Spill 5 Jackpots premie",
                "Game 5 Roulette Prize": "Spill 5 Roulette-premie",
                "Wheel of Fortune Prize": "Wheel of Fortune Premie",
                "Withdraw": "Ta ut",
                "Add Money By Agent": "Legg til penger etter agent",
                "Withdraw Money By Agent": "Ta ut penger av agent",
                "OK Bingo Add To Ticket": "OK Bingo Legg til billett",
                "OK Bingo Ticket Purchase": "OK Bingo Billettkjøp",
                "OK Bingo Close Ticket": "OK Bingo Lukk billett",
                "Metronia Add To Ticket": "Metronia Legg til billett",
                "Metronia Ticket Purchase": "Metronia Billettkjøp",
                "Metronia Close Ticket": "Metronia Lukk billett",
                "Physical Ticket Winning": "Fysisk billett vunnet",
                "Mystery Prize": "Mystery Premie"
            };
    
            const result = transactions.map(tx => {
                const {
                    category,
                    typeOfTransaction,
                    typeOfTransactionTotalAmount,
                    transactionId,
                    amtCategory,
                    status,
                    createdAt,
                    depositType
                } = tx;
    
                const type =
                    selectedLanguage === "nor"
                        ? norTranslationMap[typeOfTransaction] || typeOfTransaction
                        : typeOfTransaction;
    
                const { type: depositMode, depositId } = depositType || {};
                const uniqueReference =
                    depositMode === "Online" && depositId ? depositId : "";
    
                return {
                    date: moment(createdAt).tz('UTC').format('MMMM-DD-YYYY'),
                    amount:
                        category === "credit"
                            ? `+${typeOfTransactionTotalAmount}`
                            : `-${typeOfTransactionTotalAmount}`,
                    type,
                    id: transactionId,
                    purchasedFrom:
                        amtCategory === "realMoney" ? "Wallet" : "Points",
                    dateAndTime: moment(createdAt)
                        .tz('UTC')
                        .format('DD-MM-YYYY HH:mm:ss'),
                    status: status
                        ? status.charAt(0).toUpperCase() + status.slice(1)
                        : status,
                    uniqueReference
                };
            });
    
            return {
                status: 'success',
                result,
                message: 'Players Transaction History'
            };
    
        } catch (error) {
            Sys.Log.info('Error in TransactionHistory : ' + error);
        }
    },

    playerForgotPassword: async function (socket, data) {
        try {
            const {
                email: input,
                language = "nor"
            } = data;
    
            const {
                App,
                Database
            } = Sys.Config;
    
            const baseUrl = App[Database.connectionType].url;
    
            // Check if input is mobile or email
            const isNumeric = value => /^\d+$/.test(value);
            let byPhone = false;
            const query = isNumeric(input)
                ? (byPhone = true, { phone: input })
                : { email: input };

            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                query,
                { _id: 1, email: 1, username: 1, phone: 1, selectedLanguage: 1 }
            );
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language }),
                    statusCode: 400
                };
            }
    
            const { _id: playerId, email, phone, username, selectedLanguage } = player;
    
            // Generate reset token (5 minutes)
            const token = jwt.sign(
                { id: email },
                jwtcofig.secret,
                { expiresIn: '300s' }
            );

            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId },
                {
                    resetPasswordToken: token,
                    resetPasswordExpires: Date.now() + (24 * 60 * 60 * 1000)
                }
            );
    
            const resetLink = `${baseUrl}resetPassword/${token}`;
            
            // Translations
            const languageAdmin = selectedLanguage === "en" ? "english" : "norwegian";
            const { translations } = await playerForgotPassTranslation(
                languageAdmin
            );
    
            // Email template data
            const templateData = {
                uname: username,
                msg: translations?.player_forgot_pass_msg,
                buttonName: translations?.player_forgot_pass_btn_name,
                note: translations?.player_forgot_pass_note,
                baseUrl,
                resetLink,
                greet_hi: translations?.greet_hi,
                thank_you: translations?.thank_you,
                if_you_did_not_make_this_request: translations?.if_you_did_not_make_this_request,
                you_can_safely_ignore_this_email: translations?.you_can_safely_ignore_this_email,
            };

            if(byPhone){
                const smsMessage =
                `Spillorama Bingo : ${translations?.player_forgot_reset_password}\n` +
                `${translations?.click_link_to_reset_password}: ${encodeURI(resetLink)}`;
                const smsResult = await Sys.App.Controllers.advertisementController.sendBulkSMS([phone], smsMessage, languageAdmin);
                if (!smsResult.success) {
                    return {
                        status: 'fail',
                        result: null,
                        message: smsResult.message,
                        statusCode: 400
                    };
                }
                return {
                    status: 'success',
                    message: await translate({ key: "reset_password_sms", language: selectedLanguage })
                };
            }
    
            // Load & compile template
            const templatePath = path.join(
                __dirname,
                '../../../App/Views/templateHtml/forgot_mail_template.html'
            );
    
            const htmlTemplate = handlebars.compile(
                fs.readFileSync(templatePath, 'utf-8')
            );
    
            await defaultTransport.sendMail({
                from: Sys.Config.App.mailer.defaultFromAddress,
                to: email,
                subject: `Spillorama Bingo : ${translations?.player_forgot_reset_password}`,
                html: htmlTemplate(templateData)
            });
    
            return {
                status: "success",
                message: await translate({ key: "reset_password", language: selectedLanguage })
            };
    
        } catch (error) {
            Sys.Log.info('Error in playerForgotPassword : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },

    playerChangePassword: async function (socket, data) {
        try {
            const { playerId, oldPassword, newPassword, verifyNewPassword } = data;
            const { languageData } = socket;
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { password: 1, selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: languageData }),
                    statusCode: 400
                };
            }
    
            // Validate old password
            const isOldPasswordValid = bcrypt.compareSync(oldPassword, player.password);
            if (!isOldPasswordValid) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "change_pass_old_verify", language: player.selectedLanguage }),
                    statusCode: 400
                };
            }
    
            // Validate password length
            if (!newPassword || newPassword.length < 6) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "change_pass_limit", language: player.selectedLanguage }),
                    statusCode: 400
                };
            }
    
            // Match new & verify password
            if (newPassword !== verifyNewPassword) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "change_pass_mismatch", language: player.selectedLanguage }),
                    statusCode: 400
                };
            }
    
            // Update password
            const hashedPassword = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(8));

            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId },
                { password: hashedPassword }
            );
    
            return {
                status: 'success',
                message: await translate({ key: "change_pass_success", language: player.selectedLanguage }),
                statusCode: 200
            };
    
        } catch (error) {
            Sys.Log.info('Error in playerChangePassword : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    playerUpdateInterval: async function (socket, data) {
        try {
            const { playerId } = data;
            const { languageData } = socket;

            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { points: 1, walletAmount: 1, selectedLanguage: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: languageData }),
                    statusCode: 400
                };
            }
    
            const result = {
                playerId: player._id,
                points: Number(player.points).toFixed(2),
                realMoney: Number(player.walletAmount).toFixed(2)
            };
            
            return {
                status: 'success',
                result,
                message: "Player interval updated successfully"
            };
    
        } catch (error) {
            Sys.Log.info('Error in playerUpdateInterval : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    createBotPlayers: async function (socket, data) {
        try {
            const count = Number(data.count);
            const { hallId } = data;
            
            /* -------------------- Validations -------------------- */
            if (!count || count <= 0 || count > 1000) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Count must be between 1 and 1000.'
                };
            }
    
            if (!hallId) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Please provide valid hall.'
                };
            }
    
            /* -------------------- Hall Data -------------------- */
            const hallData = await Sys.Game.Common.Services.GameServices.getSingleHallByData(
                { _id: hallId },
                { agents: 1, name: 1, groupHall: 1 }
            );
    
            if (!hallData) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Invalid hall.'
                };
            }
    
            const hall = {
                id: hallData._id.toString(),
                name: hallData.name,
                status: 'Approved'
            };
    
            const approvedHalls = [{
                id: hall.id,
                name: hall.name,
                status: 'Approved',
                groupHall: hallData.groupHall
            }];
    
            const agent = hallData?.agents?.[0] || {};
    
            const playerAgent = {
                id: agent?.id?.toString() || '',
                name: agent?.name || ''
            };
    
            const hallApprovedBy = {
                id: agent?.id?.toString() || '',
                name: agent?.name || '',
                role: 'agent'
            };
    
            /* -------------------- Existing Bot Count -------------------- */
            const botCount = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({
                userType: 'Bot'
            });
    
            const start = botCount + 1;
            const end = start + count;
    
            /* -------------------- Create Bots -------------------- */
            for (let i = start; i < end; i++) {
    
                const customer = await module.exports.generateUniqueCustomerNumber();
                console.log("customer---", customer)
                if (!customer?.newCustomerNumber) continue;
    
                const botPlayer = {
                    username: `bot${i}`,
                    nickname: `bot${i}`,
                    surname: 'Bot',
                    email: `bot${i}@gmail.com`,
                    phone: i + Math.floor(Math.random() * 1_000_000_000),
                    walletAmount: 100000000,
                    points: 0,
                    bankId: 123,
                    hall,
                    password: bcrypt.hashSync('123456', 10),
                    socketId: `${socket.id}_${i}`,
                    status: 'Active',
                    userType: 'Bot',
                    hallId: hall.id,
                    platform_os: 'other',
                    customerNumber: customer.newCustomerNumber,
                    approvedHalls,
                    playerAgent,
                    hallApprovedBy
                };
    
                await Sys.Game.Common.Services.PlayerServices.createBotPlayers(botPlayer);
            }
    
            return {
                status: 'success',
                message: 'Bot Players created successfully!'
            };
    
        } catch (error) {
            Sys.Log.info('Error in createBotPlayers : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Something went wrong',
                statusCode: 500
            };
        }
    },
    
    // We have commented verifone payment integration because we are using swedbankpay for payment now according to the new requirement.

    // depositMoneyByVerifone: async function (socket, data) {
    //     try {
    //         console.log("depositMoney by verifone data", data);
    //         if (!data.amount || data.amount < 0) {
    //             return {
    //                 status: 'fail',
    //                 message: await translate({ key: "deposit_valid_amount", language: socket.languageData }), //'Please provide valid amount.',
    //             }
    //         }
    //         let amount = +(+data.amount * 100);
    //         let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, surname: 1, userType: 1, walletAmount: 1, phone: 1, email: 1, hall: 1, selectedLanguage: 1, customerNumber: 1 });
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 message: await translate({ key: "player_not_found", language: socket.languageData }), //'Player Not Found.',
    //             }
    //         }
    //         if (player.userType != "Online") {
    //             return {
    //                 status: 'fail',
    //                 message: await translate({ key: "deposit_permission", language: player.selectedLanguage }), //'You are not allowed to deposit amount.',
    //             }
    //         }

    //         let orderNumber = await Sys.Helper.bingo.generateUniqueOrderNum();

    //         if (data.operation == "Offline") {
    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: player.hall.id }, {  groupHall: 1 });
    //             let depositTx = await Sys.App.Services.depositMoneyServices.insertData({
    //                 playerId: player._id,
    //                 playerName: player.username,
    //                 orderNumber: orderNumber,
    //                 amount: +data.amount,
    //                 CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.currencyCode,
    //                 status: "pending",
    //                 createdAt: Date.now(),
    //                 operation: "Offline",
    //                 hallId: player.hall.id,
    //                 hallName: player.hall.name,
    //                 customerNumber: player.customerNumber,
    //                 walletAmount: +player?.walletAmount?.toFixed(2)
    //             });
    //             console.log("player.hall.id",player.hall.id);
    //             Sys.Io.of('admin').to(player.hall.id).emit('widthdarwRequest', { data : 1});

    //             // add transaction as pending,once approved update the status
    //             let transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
    //             let transactionPointData = {
    //                 transactionId: transactionId,
    //                 playerId: player._id,
    //                 playerName: player.username,
    //                 category: "credit",
    //                 status: "pending",
    //                 amtCategory: "realMoney",
    //                 defineSlug: "extraTransaction",
    //                 typeOfTransaction: "Deposit By Pay in Hall",
    //                 typeOfTransactionTotalAmount: +data.amount,
    //                 depositType: { type: data.operation, paymentBy: "", depositId: depositTx._id, orderNumber: orderNumber },
    //                 hallId: player.hall.id,
    //                 createdAt: Date.now(),
    //                 groupHall: hallsData.groupHall,
    //                 hall: {
    //                     id: player.hall.id,
    //                     name: player.hall.name
    //                 }
    //             }
    //             await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

    //             return {
    //                 status: "offline-success",
    //                 result: null,
    //                 message: await translate({ key: "deposit_success_hall", language: player.selectedLanguage }), //"Your deposit request has been forwarded to your hall agent and is now in the process. Our dedicated team will review your request promptly and proceed accordingly.",
    //             }
    //         }

    //         // if requset is initiated from webgl or windows then send false
    //         let openVippsInApp = true;
    //         if (data.os == 'windows' || data.os == 'webgl' || data.os == 'other') {
    //             openVippsInApp = false;
    //         }
    //         console.log("openVippsInApp---", openVippsInApp)
    //         let authTokenTemp = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.userId}:${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.ApiId}`;
    //         const authToken = Buffer.from(authTokenTemp).toString('base64')
    //         let expiryDate = moment().add(30, 'minutes');
    //         let paymentLanguage = "no";
    //         if (player.selectedLanguage == "en") {
    //             paymentLanguage = "en";
    //         }
    //         return axios({
    //             method: 'post',
    //             url: Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.sandboxCheckouUrl,
    //             data: {
    //                 "entity_id": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.entityId, //"84e93326-f779-4a31-b2ba-decf90b61a8e",
    //                 "currency_code": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.currencyCode,
    //                 "amount": amount,
    //                 //"customer": "string",
    //                 "configurations": {
    //                     "card": {
    //                         "payment_contract_id": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.contractId,
    //                         "mode": "PAYMENT", //"PAYMENT", //"CARD_CAPTURE",
    //                         "card_capture_mode": "v2",
    //                         "cvv_required": true,
    //                         "capture_now": true,
    //                         // "threed_secure": {
    //                         //     "threeds_contract_id": "824f42c7-3ebd-4ddf-a317-421341b8a815",
    //                         //     "enabled": true,
    //                         //     "transaction_mode": "S"
    //                         // }
    //                     },
    //                     // "vipps": {
    //                     //     "payment_contract_id": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.contractId,
    //                     //     "dynamic_descriptor": "Spilorama Bingo",
    //                     //     "capture_now": true,
    //                     //     //"is_app": openVippsInApp,  
    //                     //     //"app_phone_number": "93 44 33 55", //"+4793441119",  // indicates the phone number registered with Vipps Mobile APP
    //                     // },

    //                 },
    //                 "expiry_time": expiryDate, // hours
    //                 "merchant_reference": `Transaction initiated from Spilorama bingo.`, //"please "+ data.amount ,
    //                 "return_url": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.redirectUrl,
    //                 "i18n": {
    //                     "default_language": paymentLanguage, // "no",
    //                     "fallback_language": paymentLanguage, // "no",
    //                     "show_language_options": true
    //                 },
    //                 "interaction_type": "IFRAME", //"PAYMENT_LINK", //"HPP",
    //                 "display_line_items": false,
    //                 //"theme_id": "eb86056f-39cf-4942-b44a-a166581d9b73",
    //                 //"receipt_type": "INVOICE",
    //                 //"sales_description": "string",
    //                 "sales_channel": "ECOMMERCE",
    //                 "customer_details": {
    //                     "billing": {
    //                         "first_name": player.username,
    //                         "last_name": (player.surname) ? player.surname : player.username,
    //                         "phone": player.phone,
    //                         //"address_1": "France",
    //                         //"city": "Paris",
    //                         //"country_code": "FR",

    //                     },
    //                     "email_address": player.email,
    //                     "entity_id": Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.entityId, //"84e93326-f779-4a31-b2ba-decf90b61a8e",  // organisation id
    //                     "phone_number": player.phone,
    //                 },
    //                 "purchase_order_number": orderNumber,
    //                 "tax_indicator": "TAX_NOT_PROVIDED",
    //                 "tax_amount": 0,
    //                 "invoice_number": orderNumber,
    //             },
    //             headers: {
    //                 'Content-Type': "application/json",
    //                 'Authorization': `Basic ${authToken}`
    //             }
    //         }).then(async function (response) {
    //             console.log("response of deposit money", response.data)
    //             if (response.status == 200 && response.data) {
    //                 await Sys.App.Services.depositMoneyServices.insertData({
    //                     playerId: player._id,
    //                     playerName: player.username,
    //                     orderNumber: orderNumber,
    //                     amount: +data.amount,
    //                     CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.currencyCode,
    //                     checkoutID: response.data.id,
    //                     customerId: response.data.customer_id,
    //                     responseSource: response.data.url,
    //                     //transactionID: response.data.id,
    //                     status: "pending",
    //                     createdAt: Date.now(),
    //                     expiryDate: expiryDate,
    //                     operation: "Online",
    //                     hallId: player.hall.id,
    //                     hallName: player.hall.name,
    //                     issuerId: data.os,
    //                     'otherData.webglRefreshBroadcastCount': 0,
    //                     updatedAt: Date.now(),
    //                     customerNumber: player.customerNumber,
    //                     walletAmount: +player?.walletAmount?.toFixed(2)

    //                 });
    //                 console.log("Iframe Url", `${Sys.Config.App[Sys.Config.Database.connectionType].url}payment/iframe/${response.data.id}`)
    //                 return {
    //                     status: "success",
    //                     result: `${Sys.Config.App[Sys.Config.Database.connectionType].url}payment/iframe/${response.data.id}`,
    //                     message: "Please proceed to pay.",
    //                 }
    //             } else {
    //                 return {
    //                     status: "fail",
    //                     message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), //"Something went Wrong!",
    //                     token: ""
    //                 }
    //             }
    //         }).catch(async function (error) {
    //             console.log("error of deposit money", error.response.data, error.response.data.details);
    //             return {
    //                 status: "fail",
    //                 message: await translate({ key: "something_went_wrong", language: socket.languageData }), //"Something went Wrong!",
    //                 token: ""
    //             }
    //         });

    //     } catch (error) {
    //         console.log("Error while depositing money", error);
    //     }
    // },

    // verifonePaymentResponse: async function (req, resp) {
    //     try {
    //         console.log('PaymentResponse of verifone:', req.query);
    //         let checkout_id = req.query.checkout_id;
    //         let transactionId = req.query.transaction_id;
    //         let reponsePage = "payment/verifonePaymentRes";
    //         console.log("checkout_id", checkout_id)
    //         if (checkout_id) {
    //             let transaction = await Sys.App.Services.depositMoneyServices.getSingleByData({ checkoutID: checkout_id }, { playerId: 1, status: 1, amount: 1, issuerId: 1, otherData: 1 });
    //             console.log("transaction---", transaction);
    //             if (transaction) {
    //                 let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transaction.playerId }, { username: 1, selectedLanguage: 1, socketId: 1 });
    //                 console.log("player in verifone response", player)
    //                 if (!player) {
    //                     let data = {
    //                         status: "Error",
    //                         message: "Noe gikk galt!",
    //                         //message1: "Please Refresh this page for more updates.",
    //                         title: await translate({ key: "deposit_verifone_failed_web", language: 'nor' }),
    //                         goBack: await translate({ key: "goBackbutton", language: 'nor' })
    //                     };
    //                     return resp.render(reponsePage, data);
    //                 }

    //                 if (transaction.issuerId == "webgl") {
    //                     if (transaction.otherData.webglRefreshBroadcastCount <= 0) {
    //                         await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, checkoutID: checkout_id }, {
    //                             $inc: { 'otherData.webglRefreshBroadcastCount': 1 }
    //                         });
    //                         await Sys.Io.to(player.socketId).emit('refreshPaymentPage', { url: req.protocol + '://' + req.get('host') + req.originalUrl });
    //                         return resp.render(reponsePage, { status: "Pending", message: await translate({ key: "deposit_verifone_progress", language: player.selectedLanguage }), message1: "Please Refresh this page for more updates.", title: await translate({ key: "deposit_verifone_pending_web", language: player.selectedLanguage }), goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
    //                     }
    //                 }

    //                 if (transaction.status == "failed") {
    //                     let data = {
    //                         status: "Failed",
    //                         message: await translate({ key: "deposit_verifone_issue", language: player.selectedLanguage }), //"We're sorry, but there was an issue processing your payment. Please double-check your payment information and try again."
    //                         title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }),
    //                         goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                     }
    //                     return resp.render(reponsePage, data);
    //                 }

    //                 let getDepositUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.sandboxCheckouUrl}/${checkout_id}`;
    //                 let authTokenTemp = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.userId}:${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.ApiId}`;
    //                 const authToken = Buffer.from(authTokenTemp).toString('base64')
    //                 const options = {
    //                     method: 'get',
    //                     url: getDepositUrl,
    //                     headers: {
    //                         'Content-Type': "application/json",
    //                         'Authorization': `Basic ${authToken}`
    //                     },
    //                 };
    //                 let Trares = await axios.request(options);
    //                 if (Trares && Trares.status == 200) {
    //                     console.log("response of transaction--", Trares.data);
    //                     if (Trares.data.status == "COMPLETED") {
    //                         let data = {};
    //                         let allEvents = Trares.data.events;
    //                         if (allEvents.length > 0) {
    //                             const isIndex = allEvents.map(e => e.type).lastIndexOf('TRANSACTION_SUCCESS');
    //                             if (isIndex >= 0) {
    //                                 data = {
    //                                     status: "Completed",
    //                                     message: await translate({ key: "deposit_verifone_success", language: player.selectedLanguage }), //"Thank you for your payment! Your transaction has been successfully completed."
    //                                     title: await translate({ key: "deposit_verifone_success_web", language: player.selectedLanguage }),
    //                                     goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                                 }
    //                             } else {
    //                                 data = {
    //                                     status: "Pending",
    //                                     message: await translate({ key: "deposit_verifone_progress", language: player.selectedLanguage }), //"Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                                     //message1: await translate({key: "deposit_refresh", language: player.selectedLanguage}), // "Please Refresh this page for more updates."
    //                                     title: await translate({ key: "deposit_verifone_pending_web", language: player.selectedLanguage }),
    //                                     goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                                 };
    //                             }
    //                         } else {
    //                             data = {
    //                                 status: "Pending",
    //                                 message: await translate({ key: "deposit_verifone_progress", language: player.selectedLanguage }), //"Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                                 //message1: await translate({key: "deposit_refresh", language: player.selectedLanguage}), // "Please Refresh this page for more updates."
    //                                 title: await translate({ key: "deposit_verifone_pending_web", language: player.selectedLanguage }),
    //                                 goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                             };
    //                         }
    //                         return resp.render(reponsePage, data);
    //                     } else if (Trares.data.status == "FAILED") {
    //                         await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" }, checkoutID: checkout_id, orderNumber: Trares.data.invoice_number }, { //customerId: allEvents[isIndex].details.customer, orderNumber: allEvents[isIndex].details.invoice_number
    //                             status: "failed",
    //                             transactionID: Trares.data.transaction_id,
    //                             paymentBy: Trares.data.payment_method_used
    //                         });
    //                         data = {
    //                             status: "Failed",
    //                             message: await translate({ key: "deposit_verifone_error", language: player.selectedLanguage }), //"We're sorry, but there was an issue processing your payment. Please double-check your payment information and try again."
    //                             title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }),
    //                             goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                         }
    //                         return resp.render(reponsePage, data);
    //                     } else if (Trares.data.status == "EXPIRED") {
    //                         await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" }, checkoutID: checkout_id, orderNumber: Trares.data.invoice_number }, { //customerId: allEvents[isIndex].details.customer, orderNumber: allEvents[isIndex].details.invoice_number
    //                             status: "failed",
    //                         });
    //                         data = {
    //                             status: "Failed",
    //                             message: await translate({ key: "deposit_verifone_expired", language: player.selectedLanguage }), //"Unfortunately, your payment authorization has expired. Please restart the payment process to complete your transaction."
    //                             title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }),
    //                             goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                         }
    //                         return resp.render(reponsePage, data);
    //                     } else {
    //                         let data = {};
    //                         let allEvents = Trares.data.events;
    //                         if (allEvents.length > 0) {
    //                             //const isIndex = allEvents.map(e => e.type).lastIndexOf('TRANSACTION_FAILED');
    //                             const types = allEvents.map(e => e.type);
    //                             const failureTypes = ['TRANSACTION_FAILED', 'TRANSACTION_DECLINED'];

    //                             const isFailed = failureTypes.some(type => types.lastIndexOf(type) >= 0);

    //                             data = {
    //                                 status: isFailed ? "Failed" : "Pending",
    //                                 message: await translate({
    //                                     key: isFailed ? "deposit_verifone_error" : "deposit_verifone_progress",
    //                                     language: player.selectedLanguage
    //                                 }),
    //                                 title: await translate({
    //                                     key: isFailed ? "deposit_verifone_failed_web" : "deposit_verifone_pending_web",
    //                                     language: player.selectedLanguage
    //                                 }),
    //                                 goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                             };
    //                         } else {
    //                             data = {
    //                                 status: "Pending",
    //                                 message: await translate({ key: "deposit_verifone_progress", language: player.selectedLanguage }), //"Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                                 //message1: await translate({key: "deposit_refresh", language: player.selectedLanguage}), //"Please Refresh this page for more updates."
    //                                 title: await translate({ key: "deposit_verifone_pending_web", language: player.selectedLanguage }),
    //                                 goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                             };
    //                         }
    //                         return resp.render(reponsePage, data);
    //                     }
    //                 }
    //                 else {
    //                     console.log("Trares--", Trares)
    //                     let data = {
    //                         status: "Error",
    //                         message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), //"Something Went Wrong!",
    //                         //message1: await translate({key: "deposit_refresh", language: player.selectedLanguage}), //"Please Refresh this page for more updates."
    //                         title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }),
    //                         goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage })
    //                     };
    //                     return resp.render(reponsePage, data);
    //                 }

    //                 // if(transaction.status == "pending"){
    //                 //     console.log("status is in peding state.");

    //                 //     let getDepositUrl = `https://cst.test-gsc.vfims.com/oidc/checkout-service/v2/checkout/${checkout_id}`;
    //                 //     let authTokenTemp = "b7538c37-183c-4e85-aff3-1e55ec6be2a3:oezAXUcJAsosLOGtCDxWBERurrpQErlsZeFR";
    //                 //     const authToken = Buffer.from(authTokenTemp).toString('base64')
    //                 //     const options = {
    //                 //         method: 'get',
    //                 //         url: getDepositUrl,
    //                 //         headers: {
    //                 //             'Content-Type': "application/json",
    //                 //             'Authorization': `Basic ${authToken}` 
    //                 //         },
    //                 //     };

    //                 //     function sleep(ms) {
    //                 //         return new Promise((resolve) => {
    //                 //             setTimeout(resolve, ms);
    //                 //         });
    //                 //     }
    //                 //     await sleep(2000);

    //                 //     let Trares = await axios.request(options);
    //                 //     if(Trares && Trares.status == 200){
    //                 //         console.log("response of transaction--", Trares.data)
    //                 //         let data;

    //                 //         if(Trares.data.status == "COMPLETED"){
    //                 //             let allEvents = Trares.data.events;
    //                 //             if(allEvents.length > 0){
    //                 //                 const isIndex = allEvents.findIndex(e => e.type === 'TRANSACTION_SUCCESS');
    //                 //                 if (isIndex >= 0) {
    //                 //                     data = {
    //                 //                         status: "settled",
    //                 //                         message: "Now you can return to Spilorama Bingo."
    //                 //                     }
    //                 //                 }else{
    //                 //                     data = {
    //                 //                         status: "Pending",
    //                 //                         message: "Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                 //                         message1: "Please Refresh this page for more updates."
    //                 //                     };
    //                 //                 }
    //                 //             }else{
    //                 //                 data = {
    //                 //                     status: "Pending",
    //                 //                     message: "Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                 //                     message1: "Please Refresh this page for more updates."
    //                 //                 };
    //                 //             }
    //                 //         }else{
    //                 //             data = {
    //                 //                 status: "Pending",
    //                 //                 message: "Your Transaction is in Progress. This is usually quick, but could take up to four hours depending on your bank.",
    //                 //                 message1: "Please Refresh this page for more updates."
    //                 //             };
    //                 //         }
    //                 //         return resp.render('verifonePaymentRes', data);
    //                 //     }else{
    //                 //         console.log("Trares--", Trares)
    //                 //         let data = {
    //                 //             status: "Error",
    //                 //             message: "Something Went Wrong!",
    //                 //             message1: "Please Refresh this page for more updates."
    //                 //         };
    //                 //         return resp.render('verifonePaymentRes', data);
    //                 //     }

    //                 // }else if(transaction.status == "completed"){
    //                 //     data = {
    //                 //         status: "completed",
    //                 //         message: "Now you can return to Spilorama Bingo."
    //                 //     }
    //                 //     return resp.render('verifonePaymentRes', data);
    //                 // }else if(transaction.status == "failed"){

    //                 // }
    //             } else {
    //                 let data = {
    //                     status: "Error",
    //                     message: "Noe gikk galt.",
    //                     //message1: "Please Refresh this page for more updates.",
    //                     title: await translate({ key: "deposit_verifone_failed_web", language: 'nor' }),
    //                     goBack: await translate({ key: "goBackbutton", language: 'nor' })
    //                 };
    //                 return resp.render(reponsePage, data);
    //             }
    //         } else {
    //             let data = {
    //                 status: "Pending",
    //                 message: "Transaksjonen din pågår. Dette er vanligvis raskt, men kan ta opptil fire timer avhengig av banken din.",
    //                 //message1: "Please Refresh this page for more updates.",
    //                 title: await translate({ key: "deposit_verifone_pending_web", language: 'nor' }),
    //                 goBack: await translate({ key: "goBackbutton", language: 'nor' })
    //             };
    //             return resp.render(reponsePage, data);
    //         }

    //     } catch (error) {
    //         console.log("Error in verifonePaymentResponse:", error);
    //         let data = {
    //             status: "Pending",
    //             message: "Transaksjonen din pågår. Dette er vanligvis raskt, men kan ta opptil fire timer avhengig av banken din.",
    //             //message1: "Please Refresh this page for more updates.",
    //             title: await translate({ key: "deposit_verifone_pending_web", language: 'nor' }),
    //             goBack: await translate({ key: "goBackbutton", language: 'nor' })
    //         };
    //         return resp.render(reponsePage, data);
    //     }
    // },

    // notification: async function (req, res) {
    //     try {
    //         console.log("req.body of notification", req.body)
    //         let event_type = req.body.eventType;
    //         console.log("event_type of notification---", event_type);
    //         if (req.body.entityUid && req.body.entityUid != Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.entityId) {
    //             return res.status(200).send("Success");
    //         }
    //         if (event_type == "CheckoutTransactionSuccess" || event_type == "CheckoutTransactionFailed") {
    //             if (req.body.recordId && req.body.itemId) {
    //                 if (req.body.recordId == req.body.itemId) {
    //                     let checkout_id = req.body.recordId;
    //                     console.log("checkout_id of notification", checkout_id);
    //                     if (checkout_id) {
    //                         let transaction = await Sys.App.Services.depositMoneyServices.getSingleByData({ checkoutID: checkout_id }, { playerId: 1, status: 1, amount: 1, customerId: 1 });
    //                         console.log("transaction of notification---", transaction);
    //                         if (!transaction) {
    //                             return res.status(200).send("Success");
    //                         }
    //                         let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transaction.playerId }, { username: 1, hall: 1 });
    //                         console.log("player in verifone response of notification", player)
    //                         if (!player) {
    //                             return res.status(200).send("Success");
    //                         }
    //                         if (transaction.status != "completed") {
    //                             let getDepositUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.sandboxCheckouUrl}/${checkout_id}`;
    //                             let authTokenTemp = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.userId}:${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.ApiId}`;
    //                             const authToken = Buffer.from(authTokenTemp).toString('base64')
    //                             const options = {
    //                                 method: 'get',
    //                                 url: getDepositUrl,
    //                                 headers: {
    //                                     'Content-Type': "application/json",
    //                                     'Authorization': `Basic ${authToken}`
    //                                 },
    //                             };

    //                             let Trares = await axios.request(options);
    //                             if (Trares && Trares.status == 200) {
    //                                 console.log("response of transaction of notification--", Trares.data)
    //                                 let transactionAmount = +(Trares.data.amount / 100)
    //                                 if (+transaction.amount != transactionAmount) {
    //                                     console.log("Amount mismatch between db and webhook data from webhook.");
    //                                     return res.status(200).send("Success");
    //                                 }
    //                                 if (event_type == "CheckoutTransactionSuccess" && Trares.data.status == "COMPLETED") {

    //                                     let allEvents = Trares.data.events;
    //                                     if (allEvents.length > 0) {
    //                                         const isIndex = allEvents.findIndex(e => e.type === 'TRANSACTION_SUCCESS');
    //                                         if (isIndex >= 0) {
    //                                             console.log("event details of notification", allEvents[isIndex], allEvents[isIndex].details)
    //                                             if (allEvents[isIndex] && allEvents[isIndex].details && Trares.data.invoice_number) {
    //                                                 let updateTx = await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" }, checkoutID: checkout_id, orderNumber: Trares.data.invoice_number }, {
    //                                                     status: "completed",
    //                                                     transactionID: Trares.data.transaction_id,
    //                                                     paymentBy: Trares.data.payment_method_used,
    //                                                     updatedAt: Date.now(),
    //                                                 });
    //                                                 console.log("updateTx of notification---", updateTx);
    //                                                 if (updateTx && updateTx.modifiedCount == 0) {
    //                                                     console.log("Transaction is already completed, so no need to check again from webhook.");
    //                                                     return res.status(200).send("Success");
    //                                                 } else {
    //                                                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: transaction.playerId }, { $inc: { walletAmount: transactionAmount } });

    //                                                     let transactionPointData = {
    //                                                         transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
    //                                                         playerId: player._id,
    //                                                         hallId: player.hall.id,
    //                                                         defineSlug: "extraTransaction",
    //                                                         typeOfTransaction: "Deposit",
    //                                                         category: "credit",
    //                                                         status: "success",
    //                                                         typeOfTransactionTotalAmount: transactionAmount,
    //                                                         amtCategory: "realMoney",
    //                                                         depositType: { type: "Online", depositId: Trares.data.transaction_id },
    //                                                         createdAt: Date.now(),
    //                                                     }
    //                                                     await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
    //                                                     return res.status(200).send("Success");
    //                                                 }

    //                                             } else {
    //                                                 console.log("No valid customer availbale while checking transaction status from webhook.");
    //                                                 return res.status(200).send("Success");
    //                                             }
    //                                         } else {
    //                                             console.log("No valid event availbale while checking transaction status from webhook.");
    //                                             return res.status(200).send("Success");
    //                                         }
    //                                     } else {
    //                                         console.log("No valid event availbale while checking transaction status from webhook.");
    //                                         return res.status(200).send("Success");
    //                                     }

    //                                 } else if (event_type == "CheckoutTransactionFailed" && Trares.data.status != "COMPLETED") {
    //                                     let allEvents = Trares.data.events;
    //                                     if (allEvents.length > 0) {
    //                                         const types = allEvents.map(e => e.type);
    //                                         const failureTypes = ['TRANSACTION_FAILED', 'TRANSACTION_DECLINED'];
    //                                         const isFailed = failureTypes.some(type => types.lastIndexOf(type) >= 0);
    //                                         console.log("check if transaction is failed or declined of notification--", isFailed)
    //                                         if(isFailed){
    //                                             await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" }, checkoutID: checkout_id, orderNumber: Trares.data.invoice_number }, { //customerId: allEvents[isIndex].details.customer, orderNumber: allEvents[isIndex].details.invoice_number
    //                                                 status: "failed",
    //                                                 transactionID: Trares.data.transaction_id,
    //                                                 paymentBy: Trares.data.payment_method_used
    //                                             });
    //                                             return res.status(200).send("Success");
    //                                         }else{
    //                                             console.log("No valid event availbale while checking transaction status from webhook.");
    //                                             return res.status(200).send("Success");
    //                                         }
    //                                     } else {
    //                                         console.log("No valid event availbale while checking transaction status from webhook for failed transaction.");
    //                                         return res.status(200).send("Success");
    //                                     }
    //                                 } else {
    //                                     console.log("Something went wring, payment is not completed yet, Webhook issue.")
    //                                     return res.status(200).send("Success");
    //                                 }
    //                             } else {
    //                                 console.log("Issue in getting the transaction");
    //                                 return res.status(200).send("Success");
    //                             }

    //                         } else {
    //                             console.log("Transaction is already completed");
    //                             return res.status(200).send("Success");
    //                         }
    //                     }
    //                 } else {
    //                     return res.status(200).send("Success");
    //                 }
    //             } else {
    //                 return res.status(200).send("Success");
    //             }


    //         } else if (event_type == "TxnSaleDeclined") {
    //             console.log("Transaction sale declined call from notification");

    //             if (req.body.recordId && req.body.itemId) {
    //                 if (req.body.recordId == req.body.itemId) {
    //                     let tx_id = req.body.recordId;
    //                     let transaction = await Sys.App.Services.depositMoneyServices.getSingleByData({ transactionID: tx_id }, { playerId: 1, status: 1, amount: 1, customerId: 1 });
    //                     console.log("transaction of notification---", transaction);
    //                     if (!transaction) {
    //                         return res.status(200).send("Success");
    //                     }
    //                     if (req.body.content && req.body.content.amount && req.body.content.customer) {
    //                         let transactionAmount = +req.body.content.amount;
    //                         if (transaction.status == "completed" && +transaction.amount == transactionAmount && transaction.customerId == req.body.content.customer) {
    //                             let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transaction.playerId }, { username: 1, hall: 1 });
    //                             console.log("player in verifone response of notification", player)
    //                             if (!player) {
    //                                 return res.status(200).send("Success");
    //                             }

    //                             let getDepositUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.transactionUrl}/${tx_id}`;
    //                             let authTokenTemp = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.userId}:${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.ApiId}`;
    //                             const authToken = Buffer.from(authTokenTemp).toString('base64')
    //                             const options = {
    //                                 method: 'get',
    //                                 url: getDepositUrl,
    //                                 headers: {
    //                                     'Content-Type': "application/json",
    //                                     'Authorization': `Basic ${authToken}`
    //                                 },
    //                             };

    //                             let Trares = await axios.request(options);
    //                             if (Trares && Trares.status == 200) {
    //                                 console.log("response of transaction of notification--", Trares.data)
    //                                 let transactionAmount = +(Trares.data.amount)
    //                                 if (+transaction.amount != transactionAmount) {
    //                                     console.log("Amount mismatch between db and webhook data from webhook.");
    //                                     return res.status(200).send("Success");
    //                                 }

    //                                 if (transaction.customerId != Trares.data.customer) {
    //                                     console.log("Customer Id Mismatch.");
    //                                     return res.status(200).send("Success");
    //                                 }

    //                                 if (Trares.data.status == "SALE CANCELLED") {
    //                                     let updateTx = await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: "completed" }, {
    //                                         status: "failed",
    //                                     });
    //                                     if (updateTx && updateTx.modifiedCount == 0) {
    //                                         console.log("No need to revert deposit amount.");
    //                                         return res.status(200).send("Success");
    //                                     } else {
    //                                         console.log("Sale is cancelled after authorizing so revert amount");
    //                                         await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: transaction.playerId }, { $inc: { walletAmount: -transactionAmount } });

    //                                         await Sys.Game.Common.Services.PlayerServices.updateByData({ 'depositType.depositId': Trares.data.transaction_id }, {
    //                                             status: "failed",
    //                                         }, { new: true });
    //                                     }
    //                                 }
    //                                 return res.status(200).send("Success");

    //                             } else {
    //                                 console.log("Issue in getting the transaction by txId");
    //                                 return res.status(200).send("Success");
    //                             }
    //                         }
    //                     }
    //                 }
    //             }

    //             return res.status(200).send("Success");
    //         }
    //     } catch (error) {
    //         console.log("Error in truelayerWebhook:", error);
    //     }
    // },

    // verifoneIframe: async function (req, res) {
    //     try {
    //         console.log("checkout id", req.params.checkoutId);
    //         let payment = await Sys.App.Services.depositMoneyServices.getSingleByData({ checkoutID: req.params.checkoutId }, { playerId: 1, status: 1, amount: 1, responseSource: 1 });
    //         if (payment && payment.responseSource) {
    //             let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: payment.playerId }, { selectedLanguage: 1 });
    //             if (payment.status == "pending") {
    //                 return res.render('payment/deposit.html', { status: "pending", message: "Please Procees to pay.", url: payment.responseSource, title: "", goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
    //             } else if (payment.status == "completed") {
    //                 return res.render('payment/deposit.html', { status: "success", message: await translate({ key: "deposit_verifone_success", language: player.selectedLanguage }), url: "", title: await translate({ key: "deposit_verifone_success_web", language: player.selectedLanguage }), goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
    //             } else if (payment.status == "failed") {
    //                 return res.render('payment/deposit.html', { status: "failed", message: await translate({ key: "deposit_verifone_issue", language: player.selectedLanguage }), url: "", title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }), goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
    //             } else {
    //                 return res.render('payment/deposit.html', { status: "failed", message: await translate({ key: "deposit_verifone_expired", language: player.selectedLanguage }), url: "", title: await translate({ key: "deposit_verifone_failed_web", language: player.selectedLanguage }), goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
    //             }
    //         } else {
    //             return res.render('payment/deposit.html', { status: "failed", message: await translate({ key: "deposit_verifone_error", language: 'nor' }), url: "", title: await translate({ key: "deposit_verifone_failed_web", language: 'nor' }), goBack: await translate({ key: "goBackbutton", language: 'nor' }) });
    //         }
    //     } catch (error) {
    //         console.log("Error in verifoneIframe:", error);
    //     }
    // },

    // verifoneCronToUpdateTransaction: async function () {
    //     try {
    //         let transactions = await Sys.App.Services.depositMoneyServices.getTransactionByData({ status: "pending", operation: "Online", expiryDate: { $lt: new Date() } }, { playerId: 1, status: 1, amount: 1, checkoutID: 1 });  // operation:  "Online"
    //         if (transactions.length > 0) {
    //             let authTokenTemp = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.userId}:${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.ApiId}`;
    //             const authToken = Buffer.from(authTokenTemp).toString('base64')
    //             for (let t = 0; t < transactions.length; t++) {
    //                 console.log("transaction id", transactions[t]._id);
    //                 if (transactions[t].checkoutID && transactions[t].status == "pending") {
    //                     let getDepositUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.sandboxCheckouUrl}/${transactions[t].checkoutID}`;
    //                     const options = {
    //                         method: 'get',
    //                         url: getDepositUrl,
    //                         headers: {
    //                             'Content-Type': "application/json",
    //                             'Authorization': `Basic ${authToken}`
    //                         },
    //                     };
    //                     let Trares = await axios.request(options);
    //                     console.log("Trares.data", JSON.stringify(Trares.data));
    //                     if (Trares && Trares.status == 200) {
    //                         if (Trares.data.status == "COMPLETED") {
    //                             let transactionAmount = +(Trares.data.amount / 100)
    //                             if (+transactions[t].amount != transactionAmount) {
    //                                 console.log("Amount mismatch between db and webhook data from cron.", transactionAmount, +transactions[t].amount);
    //                             } else {
    //                                 let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transactions[t].playerId }, { username: 1, hall: 1 });
    //                                 if (player) {
    //                                     let allEvents = Trares.data.events;
    //                                     if (allEvents.length > 0) {
    //                                         const isIndex = allEvents.map(e => e.type).lastIndexOf('TRANSACTION_SUCCESS');
    //                                         if (isIndex >= 0) {
    //                                             if (allEvents[isIndex] && allEvents[isIndex].details && Trares.data.invoice_number) {

    //                                                 // check for transaction
    //                                                 // const TxOptions = {
    //                                                 //     method: 'get',
    //                                                 //     url: `https://cst.test-gsc.vfims.com/oidc/api/v2/transaction/${Trares.data.transaction_id}`,
    //                                                 //     headers: {
    //                                                 //         'Content-Type': "application/json",
    //                                                 //         'Authorization': `Basic ${authToken}` 
    //                                                 //     },
    //                                                 // };
    //                                                 // let Txres = await axios.request(TxOptions);
    //                                                 // console.log("Txres---", Txres.data)
    //                                                 // check for transaction

    //                                                 let updateTx = await Sys.App.Services.depositMoneyServices.updateData({ _id: transactions[t]._id, status: { $ne: "completed" }, checkoutID: transactions[t].checkoutID, orderNumber: Trares.data.invoice_number }, {
    //                                                     status: "completed",
    //                                                     transactionID: Trares.data.transaction_id,
    //                                                     paymentBy: Trares.data.payment_method_used
    //                                                 });
    //                                                 if (updateTx && updateTx.modifiedCount == 0) {
    //                                                     console.log("Transaction is already completed, so no need to check again from cron.");
    //                                                 } else {
    //                                                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: transactions[t].playerId }, { $inc: { walletAmount: transactionAmount } });
    //                                                     let transactionPointData = {
    //                                                         transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
    //                                                         playerId: player._id,
    //                                                         hallId: player.hall.id,
    //                                                         defineSlug: "extraTransaction",
    //                                                         typeOfTransaction: "Deposit",
    //                                                         category: "credit",
    //                                                         status: "success",
    //                                                         typeOfTransactionTotalAmount: transactionAmount,
    //                                                         amtCategory: "realMoney",
    //                                                         createdAt: Date.now(),
    //                                                     }
    //                                                     await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
    //                                                 }

    //                                             }
    //                                         }
    //                                     }
    //                                 }
    //                             }
    //                         } else if (Trares.data.status == "FAILED") {
    //                             await Sys.App.Services.depositMoneyServices.updateData({ _id: transactions[t]._id, status: { $ne: "completed" }, checkoutID: transactions[t].checkoutID, orderNumber: Trares.data.invoice_number }, {
    //                                 status: "failed",
    //                                 transactionID: Trares.data.transaction_id,
    //                                 paymentBy: Trares.data.payment_method_used
    //                             });
    //                         } else if (Trares.data.status == "EXPIRED") {
    //                             await Sys.App.Services.depositMoneyServices.updateData({ _id: transactions[t]._id, status: { $ne: "completed" }, checkoutID: transactions[t].checkoutID, orderNumber: Trares.data.invoice_number }, { //customerId: allEvents[isIndex].details.customer, orderNumber: allEvents[isIndex].details.invoice_number
    //                                 status: "failed",
    //                             });
    //                         }
    //                     }
    //                 }

    //             }
    //         }
    //     } catch (error) {
    //         console.log("Error in verifoneIframe:", error);
    //     }
    // },

    // goBacktoAppFromVerifone: async function (req, res) {
    //     try {
    //         console.log("checkout id", req.body.id);
    //         let payment = await Sys.App.Services.depositMoneyServices.getSingleByData({ checkoutID: req.body.id }, { playerId: 1, status: 1 });
    //         if (payment) {
    //             let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: payment.playerId }, { socketId: 1 });
    //             if (player) {
    //                 await Sys.Io.to(player.socketId).emit('closePaymentPage', {});
    //                 return res.send({ status: "success", message: "Broadcast sent successfully.", url: "" });
    //             }
    //             return res.send({ status: "failed", message: "Something went wrong.", url: "" });
    //         } else {
    //             return res.send({ status: "failed", message: "Something went wrong.", url: "" });
    //         }
    //     } catch (error) {
    //         console.log("Error in go back to app from verifone:", error);
    //     }
    // },

    // Deposit money for offline and online mode(swedbankpay)
    depositMoneyOfflineAndOnline: async function (socket, data) {
        try {
            console.log("depositMoney by offline and online data", data);
            
            // Destructure and validate input
            const { amount, playerId, operation, os } = data;
            
            // Early validation with better error handling
            if (!amount || amount < 0) {
                return {
                    status: 'fail',
                    message: await translate({ key: "deposit_valid_amount", language: socket.languageData }),
                };
            }
            
            // Convert amount once and validate
            const amountInCents = Math.round(+amount * 100);
            if (amountInCents <= 0) {
                return {
                    status: 'fail',
                    message: await translate({ key: "deposit_valid_amount", language: socket.languageData }),
                };
            }
            
            // Fetch player data with optimized projection
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId }, 
                { 
                    username: 1, 
                    surname: 1, 
                    userType: 1, 
                    walletAmount: 1, 
                    phone: 1, 
                    email: 1, 
                    hall: 1, 
                    selectedLanguage: 1, 
                    customerNumber: 1 
                }
            );
            
            if (!player) {
                return {
                    status: 'fail',
                    message: await translate({ key: "player_not_found", language: socket.languageData }),
                };
            }
            
            if (player.userType !== "Online") {
                return {
                    status: 'fail',
                    message: await translate({ key: "deposit_permission", language: player.selectedLanguage }),
                };
            }
    
            // Generate order number early
            const orderNumber = await generateUniqueOrderNum();
    
            // Route to appropriate handler based on operation type
            if (operation === "Offline") {
                return await handleOfflineDeposit(player, data, orderNumber, socket);
            } else {
                return await handleOnlineDeposit(player, data, orderNumber, amountInCents, socket);
            }
    
        } catch (error) {
            console.log("Error while depositing money", error);
            return {
                status: 'fail',
                message: await translate({ key: "something_went_wrong", language: socket.languageData }),
            };
        }
    },

    // Open payment page in iframe of swedbankpay
    swedbankpayIframe: async function (req, res) {
        try {console.log("swedbankpayIframe", req.params);
            const { checkoutId } = req.params;
            console.log("checkout id from wedbankpay iframe", checkoutId);
        
            const payment = await Sys.App.Services.depositMoneyServices.getSingleByData(
                { orderNumber: checkoutId },
                { playerId: 1, status: 1, responseSource: 1 }
            );
      
            const lang = payment?.playerId
                ? (await Sys.Game.Common.Services.PlayerServices.getOneByData(
                    { _id: payment.playerId },
                    { selectedLanguage: 1 }
                ))?.selectedLanguage || "nor"
                : "nor";
        
            // Map statuses → translation/static configs
            const statusMap = {
                completed: {
                    status: "success",
                    msgKey: "deposit_verifone_success",
                    titleKey: "deposit_verifone_success_web",
                },
                failed: {
                    status: "failed",
                    msgKey: "deposit_verifone_error",
                    titleKey: "deposit_verifone_failed_web",
                },
                pending: {
                    status: "pending",
                    staticMessage: "Please Procees to pay.",
                    url: p => p.responseSource,
                },
                aborted: {
                    status: "failed",
                    msgKey: "deposit_verifone_aborted",
                    titleKey: "deposit_verifone_failed_web",
                },
                cancelled: {
                    status: "failed",
                    msgKey: "deposit_verifone_cancelled",
                    titleKey: "deposit_verifone_failed_web",
                },
                expired: {
                    status: "failed",
                    msgKey: "deposit_verifone_expired",
                    titleKey: "deposit_verifone_failed_web",
                },
                error: {
                    status: "failed",
                    msgKey: "deposit_verifone_error",
                    titleKey: "deposit_verifone_failed_web",
                },
            };
      
            // Pick config
            const cfg =
                !payment || !payment.responseSource
                ? statusMap.error
                : statusMap[payment.status] || statusMap.expired;
      
            return res.render("payment/deposit-swedbankpay.html", {
                status: cfg.status,
                message:
                    cfg.staticMessage ||
                    (await translate({ key: cfg.msgKey, language: lang })),
                title: cfg.titleKey
                    ? await translate({ key: cfg.titleKey, language: lang })
                    : "",
                url: typeof cfg.url === "function" ? cfg.url(payment) : "",
                goBack: await translate({ key: "goBackbutton", language: lang }),
                culture: lang === "en" ? "en-US" : "nb-NO"
            });
        } catch (error) {
          console.error("Error in swedbankpayIframe:", error);
        }
    },

    // handle payment response from swedbankpay
    swedbankpayPaymentResponse: async function (req, resp) {
        console.log("swedbankpayPaymentResponse", req.query)
        const reponsePage = "payment/swedbank-payment-response";
    
        const renderResponse = async (status, messageKey, titleKey, language = 'nor') => {
            return resp.render(reponsePage, {
                status,
                message: await translate({ key: messageKey, language }),
                title: await translate({ key: titleKey, language }),
                goBack: await translate({ key: "goBackbutton", language })
            });
        };
    
        const defaultPending = async (language = 'nor') =>
            renderResponse("Pending", "deposit_verifone_progress", "deposit_verifone_pending_web", language);
    
        try {
            const { order_number: orderNumber } = req.query;
            if (!orderNumber) return defaultPending();
    
            const transaction = await Sys.App.Services.depositMoneyServices.getSingleByData(
                { orderNumber },
                { playerId: 1, status: 1, amount: 1, issuerId: 1, otherData: 1, checkoutID: 1 }
            );
            console.log("transaction of swedbankpayPaymentResponse", transaction);
            if (!transaction) return await renderResponse("Error", "something_went_wrong", "deposit_verifone_failed_web");
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: transaction.playerId },
                { username: 1, selectedLanguage: 1, socketId: 1, hall: 1 }
            );
            const lang = player?.selectedLanguage || 'nor';
    
            // Unified transaction handling mapping
            const handleTransaction = {
                WEBGL_REFRESH: async () => {
                    await Sys.App.Services.depositMoneyServices.updateData(
                        { _id: transaction._id, orderNumber },
                        { $inc: { 'otherData.webglRefreshBroadcastCount': 1 } }
                    );
                    if (player?.socketId) {
                        await Sys.Io.to(player.socketId).emit('refreshPaymentPage', {
                            url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
                        });
                    }
                    return defaultPending(lang);
                },
                FAILED: async () => renderResponse("Failed", "deposit_verifone_issue", "deposit_verifone_failed_web", lang),
                ABORTED: async () => renderResponse("Failed", "deposit_verifone_aborted", "deposit_verifone_failed_web", lang),
                CANCELLED: async () => renderResponse("Failed", "deposit_verifone_cancelled", "deposit_verifone_failed_web", lang),
                VERIFY: async () => {
                    const paymentResponse = await verifyAndCaptureSwedbankPayment({checkout_path: transaction?.otherData.paymentOrderId, player, transaction, isWebhook: false});
                    
                    switch (paymentResponse.status) {
                        case "completed":
                            return renderResponse("Completed", "deposit_verifone_success", "deposit_verifone_success_web", lang);
                        case "failed":
                            return renderResponse("Failed", "deposit_verifone_error", "deposit_verifone_failed_web", lang);
                        case "aborted":
                            return renderResponse("Failed", "deposit_verifone_aborted", "deposit_verifone_failed_web", lang);
                        case "cancelled":
                            return renderResponse("Failed", "deposit_verifone_cancelled", "deposit_verifone_failed_web", lang);
                        case "pending":
                            return defaultPending(lang);
                        case "error":
                        default:
                            console.error("Unexpected error:", result);
                            return renderResponse("Error", "something_went_wrong", "deposit_verifone_failed_web", lang);
                    }
                }
            };
    
            // Decide which handler to execute
            // if (transaction.issuerId === "webgl" && transaction.otherData.webglRefreshBroadcastCount <= 0) {
            //     return handleTransaction.WEBGL_REFRESH();
            // } else 
            if (transaction.status === "failed") {
                return handleTransaction.FAILED();
            } else if(transaction.status === "aborted") {
                return handleTransaction.ABORTED();
            } else if(transaction.status === "cancelled") {
                return handleTransaction.CANCELLED();
            } else {
                return handleTransaction.VERIFY();
            }
    
        } catch (error) {
            console.error("Error in verifonePaymentResponse:", error);
            return defaultPending();
        }
    },
    
    swedbankpayNotification: async function (req, res) {
        try {
            // Delay execution by 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log("req.body of notification", req.body);
            const { orderReference, paymentOrder } = req.body;
            if (!paymentOrder || !paymentOrder.id || !orderReference) {
                console.error("Missing paymentOrder or orderReference in callback");
                return res.sendStatus(400);
            }

            let transaction = await Sys.App.Services.depositMoneyServices.getSingleByData({ orderNumber: orderReference, 'otherData.paymentOrderId': paymentOrder.id }, { playerId: 1, status: 1, amount: 1, customerId: 1, otherData: 1, checkoutID: 1 });
            
            if (!transaction) {
                return res.sendStatus(400);
            }

            if(transaction.status !== "pending") {
                console.log("Transaction is not pending, so no need to verify and capture from swedbank callback.");
                return res.sendStatus(200);
            }

            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transaction.playerId }, { username: 1, hall: 1 });
            
            if (!player) {
                return res.sendStatus(400);
            }

            await verifyAndCaptureSwedbankPayment({checkout_path: transaction?.otherData.paymentOrderId, player, transaction, isWebhook: true});
            
            return res.sendStatus(200);
        } catch (error) {
            console.log("Error in swedbankpayNotification:", error);
        }
    },

    goBacktoAppFromSwedbankpay: async function (req, res) {
        try {
            console.log("checkout id of go back from swedbankpay", req.body.id, req.body, req.query);
            let payment = await Sys.App.Services.depositMoneyServices.getSingleByData({ orderNumber: req.body.id }, { playerId: 1, status: 1 });
            if (payment) {
                let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: payment.playerId }, { socketId: 1 });
                if (player) {
                    await Sys.Io.to(player.socketId).emit('closePaymentPage', {});
                    return res.send({ status: "success", message: "Broadcast sent successfully.", url: "" });
                }
                return res.send({ status: "failed", message: "Something went wrong.", url: "" });
            } else {
                return res.send({ status: "failed", message: "Something went wrong.", url: "" });
            }
        } catch (error) {
            console.log("Error in go back to app from verifone:", error);
        }
    },

    // Cron to update the final status of the transactions that are pending
    swedbankpayCronToUpdateTransaction: async function () {
        try {
            const transactions = await Sys.App.Services.depositMoneyServices.getTransactionByData(
                { status: "pending", operation: "Online", $or: [{'otherData.isExecuted': true}, { expiryDate: { $lt: new Date() } }]   },
                { playerId: 1, status: 1, amount: 1, customerId: 1, otherData: 1, checkoutID: 1 }
            );
            
            if (!transactions.length) return;
    
            // Only keep transactions with valid paymentOrderId
            const validTransactions = transactions.filter(tx => tx?.otherData?.paymentOrderId);
            if (!validTransactions.length) {
                console.log("No valid transactions with paymentOrderId found");
                return;
            }
    
            // Prefetch all players
            const uniquePlayerIds = [...new Set(validTransactions.map(tx => tx.playerId.toString()))];
            const players = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers(
                { _id: { $in: uniquePlayerIds } },
                { username: 1, hall: 1 }
            );
            const playerMap = new Map(players.map(p => [p._id.toString(), p]));
    
            const BATCH_SIZE = 5;
            const DELAY_MS = 100;
    
            const results = { processed: 0, successful: 0, failed: 0, errors: [] };
    
            // Helper to process a single transaction
            const processTransaction = async (tx) => {
                try {
                    const player = playerMap.get(tx.playerId.toString());
                    if (!player) throw new Error(`Player not found for transaction ${tx._id}`);
    
                    console.log("Processing transaction:", tx._id);
    
                    const result = await verifyAndCaptureSwedbankPayment({
                        checkout_path: tx.otherData.paymentOrderId,
                        player,
                        transaction: tx,
                        isWebhook: true // to capture payment if already paid
                    });
    
                    return { transactionId: tx._id, success: true, result };
                } catch (err) {
                    return { transactionId: tx._id, success: false, error: err.message };
                }
            };
    
            // Process in batches
            for (let i = 0; i < validTransactions.length; i += BATCH_SIZE) {
                const batch = validTransactions.slice(i, i + BATCH_SIZE);
    
                const batchResults = await Promise.allSettled(batch.map(processTransaction));
    
                for (const [idx, res] of batchResults.entries()) {
                    results.processed++;
                    if (res.status === "fulfilled" && res.value.success) {
                        results.successful++;
                    } else {
                        results.failed++;
                        results.errors.push({
                            transactionId: res.status === "fulfilled" ? res.value.transactionId : batch[idx]._id,
                            error: res.status === "fulfilled" ? res.value.error : res.reason?.message || "Unknown error"
                        });
                    }
                }
    
                // Add small delay only if there are more batches left
                if (i + BATCH_SIZE < validTransactions.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                }
            }
    
            console.log("Swedbank payment cron completed:", {
                total: validTransactions.length,
                ...results,
                errors: results.errors.length ? results.errors : "None"
            });

            // After performing the cron, update the status of the transactions that are pending to expired if expiryDate passed
            await Sys.App.Services.depositMoneyServices.updateManyData(
                { status: "pending", expiryDate: { $lt: new Date() } }, 
                { $set: { status: "expired" } }
            );
        } catch (error) {
            console.error("Error in swedbankpayCronToUpdateTransaction:", error);
        }
    },
    
    verifyPassword: async function (socket, data) {
        try {
            const { playerId, password } = data;
            const language = socket.languageData;
    
            if (!playerId) {
                return {
                    status: 'fail',
                    message: await translate({ key: 'withdraw_playerid', language })
                };
            }
    
            if (!password) {
                return {
                    status: 'fail',
                    message: await translate({ key: 'withdraw_password', language })
                };
            }
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { password: 1, bankId: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: 'something_went_wrong', language })
                };
            }
    
            const isValidPassword = bcrypt.compareSync(password, player.password);
    
            if (!isValidPassword) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: 'invalid_credentials', language })
                };
            }
    
            return {
                status: 'success',
                result: { bankAccountNumber: player.bankId },
                message: 'Valid credentials. Please proceed with withdrawal.'
            };
    
        } catch (error) {
            Sys.Log.info('Error in verifyPassword : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Internal server error',
                statusCode: 500
            };
        }
    },
    
    playerWithdrawMoney: async function (socket, data) {
        try {
            const { amount, withdrawType, password, playerId } = data;
            const language = socket.languageData;
    
            /* -------------------- Validations -------------------- */
            const transactionAmount = Number(amount);
    
            if (!transactionAmount || transactionAmount <= 0) {
                return {
                    status: 'fail',
                    message: await translate({ key: 'withdraw_amount', language })
                };
            }
    
            if (!withdrawType) {
                return {
                    status: 'fail',
                    message: await translate({ key: 'withdraw_type', language })
                };
            }
    
            if (!password) {
                return {
                    status: 'fail',
                    message: await translate({ key: 'withdraw_password', language })
                };
            }
    
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                {
                    username: 1,
                    nickname: 1,
                    surname: 1,
                    walletAmount: 1,
                    hall: 1,
                    password: 1,
                    bankId: 1,
                    selectedLanguage: 1,
                    customerNumber: 1
                }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: 'player_not_found', language }),
                    statusCode: 400
                };
            }
    
            const isPasswordValid = bcrypt.compareSync(password, player.password);
            if (!isPasswordValid) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: 'invalid_credentials',
                        language: player.selectedLanguage
                    })
                };
            }
    
            if (player.walletAmount < transactionAmount) {
                return {
                    status: 'fail',
                    result: {
                        playerId: player._id,
                        username: player.username
                    },
                    message: await translate({
                        key: 'Insufficient_balance',
                        language: player.selectedLanguage
                    }),
                    statusCode: 401
                };
            }
    
            /* -------------------- Withdraw Type -------------------- */
            let withdrawTypeLabel;
            if (withdrawType === 'hall') {
                withdrawTypeLabel = 'Withdraw in Hall';
            } else if (withdrawType === 'bank') {
                if (!player.bankId) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: 'provide_valid_bank',
                            language: player.selectedLanguage
                        })
                    };
                }
                withdrawTypeLabel = 'Withdraw in Bank';
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: 'withdraw_type',
                        language: player.selectedLanguage
                    })
                };
            }
    
            /* -------------------- Transaction Creation -------------------- */
            const transactionId =
                'TRN' +
                (await Sys.Helper.bingo.ordNumFunction(Date.now())) +
                Math.floor(100000 + Math.random() * 900000);
    
            const withdrawObj = {
                transactionId,
                playerId: player._id,
                name: `${player.nickname} ${player.surname}`,
                withdrawAmount: transactionAmount,
                playerKr: player.walletAmount,
                withdrawType: withdrawTypeLabel,
                hallId: player.hall.id,
                hallName: player.hall.name,
                status: 'pending',
                socketId: socket.id,
                bankAccountNumber: withdrawType === 'bank' ? player.bankId : '',
                createdAt: Date.now(),
                customerNumber: player.customerNumber
            };
    
            const withdraw = await Sys.Game.Common.Services.PlayerWithdraw.insertData(withdrawObj);
            if (!withdraw) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: 'something_went_wrong',
                        language: player.selectedLanguage
                    })
                };
            }
    
            /* -------------------- Update Wallet -------------------- */
            const updatedPlayer =
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    player._id,
                    { $inc: { walletAmount: -transactionAmount } }
                );
    
            /* -------------------- Transaction Log -------------------- */
            await Sys.Game.Common.Services.PlayerServices.createTransaction({
                transactionId,
                playerId: player._id,
                playerName: player.username,
                category: 'debit',
                status: 'pending',
                amtCategory: 'realMoney',
                defineSlug: 'extraTransaction',
                typeOfTransaction: withdrawTypeLabel,
                typeOfTransactionTotalAmount: transactionAmount,
                hallId: player.hall.id,
                previousBalance: updatedPlayer.walletAmount - transactionAmount,
                afterBalance: updatedPlayer.walletAmount,
                depositType:
                    withdrawType === 'bank'
                        ? { paymentBy: 'Bank', bankAccountNumber: player.bankId }
                        : {},
                createdAt: Date.now()
            });
    
            /* -------------------- Response Message -------------------- */
            const displayMessage =
                withdrawType === 'bank'
                    ? await translate({
                          key: 'withdraw_success_bank',
                          language: player.selectedLanguage,
                          isDynamic: true,
                          number: transactionAmount,
                          number1: player.bankId
                      })
                    : await translate({
                          key: 'withdraw_success_hall',
                          language: player.selectedLanguage,
                          isDynamic: true,
                          number: transactionAmount
                      });
    
            Sys.Io.of('admin')
                .to(player.hall.id)
                .emit('widthdarwRequest', { data: 1 });
    
            return {
                status: 'success',
                result: null,
                message: displayMessage
            };
    
        } catch (error) {
            Sys.Log.info('Error in playerWithdrawMoney : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Internal server error',
                statusCode: 500
            };
        }
    },
    
    generateUniqueCustomerNumber: async function () {
        try {
            const lastPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                {},
                { customerNumber: 1 },
                { sort: { customerNumber: -1 } }
            );
    
            let newCustomerNumber = (lastPlayer?.customerNumber || 0) + 1;
            
            /* Safety limit to avoid infinite loop */
            let attempts = 0;
            const MAX_ATTEMPTS = 1000;
    
            while (attempts < MAX_ATTEMPTS) {
                const exists = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                    { customerNumber: newCustomerNumber },
                    { _id: 1 }
                );
    
                if (!exists) {
                    return {
                        status: 'success',
                        newCustomerNumber
                    };
                }
    
                newCustomerNumber++;
                attempts++;
            }
    
            throw new Error('Unable to generate unique customer number');
    
        } catch (error) {
            Sys.Log.info('Error in generateUniqueCustomerNumber : ' + error);
            return {
                status: 'fail'
            };
        }
    },
    
    generateExcelOfWithdraw: async function () {
        try {
            const timezone = 'Europe/Oslo';
    
            /* -------------------- Fetch Active Halls -------------------- */
            const halls = await Sys.App.Services.HallServices.getByData(
                { status: "active", isDeleted: false },
                { name: 1 }
            );
    
            if (!halls?.length) {
                console.log("No active halls found.");
                return;
            }
    
            /* -------------------- Fetch Email Recipients -------------------- */
            const emailDocs = await Sys.App.Services.WithdrawServices.getEmailsByData({}, { email: 1 });
            const emails = emailDocs.map(e => e.email).filter(Boolean);
    
            if (!emails.length) {
                console.log("No email IDs found for sending withdraw excel file.");
                return;
            }
    
            console.log("Emails to send excel:", emails);
    
            /* -------------------- Date Range (Yesterday) -------------------- */
            const startDate = moment().tz(timezone).subtract(1, 'day').startOf('day').toDate();
            const endDate = moment().tz(timezone).subtract(1, 'day').endOf('day').toDate();
            const formattedDate = moment().tz(timezone).subtract(1, 'day').format("DD-MM-YYYY");
    
            /* -------------------- Utility: Delay -------------------- */
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    
            /* -------------------- Process Each Hall -------------------- */
            for (const hall of halls) {
    
                const query = {
                    status: "pending",
                    withdrawType: "Withdraw in Bank",
                    hallId: hall._id.toString(),
                    createdAt: { $gte: startDate, $lte: endDate }
                };
    
                const withdrawData = await Sys.App.Services.WithdrawServices.getWithdrawByData(
                    query,
                    {
                        withdrawAmount: 1,
                        name: 1,
                        bankAccountNumber: 1,
                        createdAt: 1,
                        status: 1,
                        hallName: 1
                    },
                    { sort: { createdAt: -1 } }
                );
    
                /* -------------------- Create Excel -------------------- */
                const excelFilePath = await createExcel(withdrawData, hall._id.toString());
                console.log(`Excel file created: ${excelFilePath}`);
    
                /* -------------------- Email Configuration -------------------- */
                const mailOptions = {
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    to: emails,
                    subject: `Withdraw Transaction Excel File of date ${formattedDate}`,
                    text: `Please find the Excel file attached of hall Name "${hall.name}".`,
                    attachments: [{ filename: excelFilePath, path: excelFilePath }]
                };
    
                /* -------------------- Send Email -------------------- */
                await new Promise(resolve => {
                    defaultTransport.sendMail(mailOptions, (error) => {
                        if (error) {
                            console.log("Error sending email:", error);
                        } else {
                            console.log(`Email sent for hall: ${hall.name}`);
                        }
    
                        /* -------------------- Delete File -------------------- */
                        fs.unlink(excelFilePath, err => {
                            if (err) console.log("Error deleting file:", err);
                            else console.log("Excel file deleted:", excelFilePath);
                        });
    
                        resolve();
                    });
                });
    
                await wait(2000);
            }
    
        } catch (error) {
            console.log("Error in generateExcelOfWithdraw:", error);
        }
    },
    
    CheckPlayerBreakTime: async function (socket, data) {
        try {
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: data.playerId },
                { startBreakTime: 1, endBreakTime: 1, socketId: 1 }
            );
    
            if (!player) {
                return {
                    status: 'fail',
                    result: {},
                    message: 'Player not found'
                };
            }
    
            const now = new Date();
            let isBreak =
                player.startBreakTime &&
                player.endBreakTime &&
                now >= player.startBreakTime &&
                now <= player.endBreakTime;
    
            // If player is not in break window, skip game checks
            if (isBreak) {
                const gameCheckMap = {
                    Game2: async () =>
                        Sys.Game.Common.Services.GameServices.getSingleGameData({
                            status: { $nin: ['finish'] },
                            "players.id": player._id,
                            gameType: 'game_2',
                            isNotificationSent: true
                        }),
    
                    Game3: async () =>
                        Sys.Game.Common.Services.GameServices.getSingleGameData({
                            status: { $nin: ['finish'] },
                            "players.id": player._id,
                            gameType: 'game_3',
                            isNotificationSent: true
                        }),
    
                    Game4: async () =>
                        Sys.Game.Common.Services.GameServices.getSingleSubGameData({
                            status: 'finish',
                            "otherData.isBallWithdrawn": false,
                            "players.id": player._id,
                            gameType: 'game_4'
                        }),
    
                    Game5: async () =>
                        Sys.Game.Game5.Services.GameServices.getSingleSubgameData({
                            status: 'Running',
                            "player.id": data.playerId,
                            gameType: 'game_5'
                        })
                };
    
                if (gameCheckMap[data.gameType]) {
                    const gameExists = await gameCheckMap[data.gameType]();
                    isBreak = gameExists ? false : true;
                }
            }
    
            const breakData = {
                isBreak,
                startBreakTime: player.startBreakTime,
                endBreakTime: player.endBreakTime
            };
    
            if (player.socketId) {
                Sys.Io.to(player.socketId).emit('breakTimeStart', breakData);
            }
    
            return {
                status: 'success',
                result: breakData,
                message: 'Break time checked successfully'
            };
    
        } catch (error) {
            console.error('Error in CheckPlayerBreakTime:', error);
            return {
                status: 'fail',
                result: {},
                message: 'Something went wrong.'
            };
        }
    },
    
    /**
     * lastHourLossProfit: Calculate the loss and profit of a player for the last hour before break time.
     *   Not required as it is now merged in myWinnings
     * @param {Object} socket - The socket object of the player
     * @param {Object} data - The data object containing the player id and the game type
     * 
     * @returns {Object} - An object containing the total bet, total winning and loss profit of the player
     */
    // lastHourLossProfit: async function (socket, data) {
    //     try {
    //         let PlayerDetails = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId }, {startBreakTime: 1, endBreakTime: 1, hall: 1});
    //         let lastHourLossProfit = {
    //             totalBet: 0,
    //             totalwinn: 0,
    //             lossProfit: 0,
    //         };
    //         if(PlayerDetails?.startBreakTime){
    //             let endBreakTime = moment(PlayerDetails?.endBreakTime);
    //             if( endBreakTime && endBreakTime > moment()){
    //                 let lastHourDate = moment(PlayerDetails?.startBreakTime).subtract(62, 'minutes').toDate(); // 7 minutes
    //                 let startBreakTime = new Date(PlayerDetails?.startBreakTime);
    //                 console.log("break start and endTime count", lastHourDate, startBreakTime)
    //                 let query = [
    //                     {
    //                         '$match': {
    //                             "playerId": data.playerId,
    //                             "hallId": PlayerDetails.hall.id,
    //                             "defineSlug": { "$nin": ["loyalty", "leaderboard"] },
    //                             "isBotGame": false,
    //                             "gameType": { "$exists": true, "$ne": "" },
    //                             "$expr": { // Use $expr to evaluate conditional logic
    //                                 "$and": [
    //                                     {
    //                                         "$or": [
    //                                             {
    //                                                 "$and": [
    //                                                     { "$in": ["$gameType", ["game_1", "game_2", "game_3"]] },
    //                                                     {
    //                                                         "$and": [
    //                                                             { "$ne": ["$otherData.exactGameStartTime", null] },
    //                                                             { "$gte": ["$otherData.exactGameStartTime", lastHourDate] },
    //                                                             { "$lte": ["$otherData.exactGameStartTime", startBreakTime] }
    //                                                         ]
    //                                                     }
    //                                                 ]
    //                                             },
    //                                             {
    //                                                 "$and": [
    //                                                     { "$in": ["$gameType", ["game_4", "game_5"]] },
    //                                                     {
    //                                                         "$and": [
    //                                                             { "$ne": ["$gameStartDate", null] },
    //                                                             { "$gte": ["$gameStartDate", lastHourDate] },
    //                                                             { "$lte": ["$gameStartDate", startBreakTime] }
    //                                                         ]
    //                                                     }
    //                                                 ]
    //                                             }
    //                                         ]
    //                                     }
    //                                 ]
    //                             }
    //                         }
    //                     },
    //                     {
    //                         '$group': {
    //                             '_id': null, // Group all documents into a single group
    //                             'totalBuy': {
    //                                 '$sum': {
    //                                     '$cond': [
    //                                         {
    //                                             '$or': [
    //                                                 { '$eq': ['$game1Slug', 'buyTicket'] },
    //                                                 { '$eq': ['$defineSlug', 'buyTicket'] },
    //                                                 { '$and': [{ '$eq': ['$gameType', 'game_5'] }, { '$eq': ['$typeOfTransaction', 'Game Joined'] }] },
    //                                                 { '$eq': ['$game1Slug', 'replaceTicket'] }
    //                                             ]
    //                                         }, '$typeOfTransactionTotalAmount', 0
    //                                     ]
    //                                 }
    //                             },
    //                             'totalCancel': {
    //                                 '$sum': {
    //                                     '$cond': [
    //                                         {
    //                                             '$or': [
    //                                                 { '$eq': ['$game1Slug', 'cancelTicket'] },
    //                                                 { '$eq': ['$defineSlug', 'cancelTicket'] }
    //                                             ]
    //                                         }, '$typeOfTransactionTotalAmount', 0
    //                                     ]
    //                                 }
    //                             },
    //                             'totalWinning': {
    //                                 '$sum': '$winningPrice'
    //                             }
    //                         }
    //                     },
    //                     {
    //                         '$project': {
    //                             '_id': 0,
    //                             'totalBet': { '$subtract': ['$totalBuy', '$totalCancel'] }, // Calculate totalBet as (totalBuy - totalCancel)
    //                             'totalWinning': 1,
    //                             //'lossProfit': { '$subtract': [{ '$subtract': ['$totalBuy', '$totalCancel'] }, '$totalWinning'] } // Calculate lossProfit as (totalBet - totalWinning)
    //                         }
    //                     }
    //                 ];
    //                 // Execute the query
    //                 let result = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(query);
    //                 if (result && result.length > 0) {
    //                     lastHourLossProfit = {
    //                         totalBet: result[0].totalBet,
    //                         totalwinn: result[0].totalWinning,
    //                         lossProfit: result[0].totalWinning - result[0].totalBet
    //                     };
    //                 }
    //             }
                
    //         }
    //         return {
    //             status: 'success',
    //             result: lastHourLossProfit,
    //             message: 'Last Hours Loss and Profit'
    //         }
    //     } catch (error) {
    //         console.log('Catch error in lastHourLossProfit:',error);
    //         return {
    //             status: 'fail',
    //             result: {},
    //             message: 'Something went wrong'
    //         }
    //     }
    // },

    CheckGame2PlayerBreakTime: async function (socket, data) {
        try {
            let PlayerDetails = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId }, {startBreakTime: 1, endBreakTime: 1});
            if(PlayerDetails){
                let isBreak= false;
                let curentTime = moment(new Date());
                if(curentTime >= PlayerDetails?.startBreakTime && curentTime <= PlayerDetails?.endBreakTime){
                    console.log('if breakTimeStart');
                    let gamesDetails = await Sys.Game.Common.Services.GameServices.getByData({"players.id": PlayerDetails._id,gameType:'game_2',status:'active'});
                    if(gamesDetails.length > 0){
                        for (let game of gamesDetails) {
                            if(game?.gameType == 'game_2'){
                                let game2Data = {
                                    playerId: data.playerId,
                                    parentGameId: game?.parentGameId,
                                    subGameId: game?._id,
                                    language: data.language
                                }
                                await Sys.Game.Game2.Controllers.GameController.cancelGameTickets(socket, game2Data)
                            }
                        }
                    }
                    isBreak= true;
                }
                
                let breakData = {
                    isBreak: isBreak,
                    startBreakTime: PlayerDetails?.startBreakTime,
                    endBreakTime: PlayerDetails?.endBreakTime
                }
                await Sys.Io.to(PlayerDetails?.socketId).emit('breakTimeStart', breakData); 
            }
            return true;
        } catch (e) {
            console.log("Error in creating data", e);
            return false;
        }
    },

    CheckGame3PlayerBreakTime: async function (socket, data) {
        try {
            let PlayerDetails = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId }, {startBreakTime: 1, endBreakTime: 1});
            if(PlayerDetails){
                let isBreak= false;
                let curentTime = moment(new Date());
                if(curentTime >= PlayerDetails?.startBreakTime && curentTime <= PlayerDetails?.endBreakTime){
                    console.log('if breakTimeStart');
                    let gamesDetails = await Sys.Game.Common.Services.GameServices.getByData({status:'active',"players.id": PlayerDetails._id,gameType:'game_3'});
                    console.log("gamesDetails in check game 3 break---", gamesDetails)
                    if(gamesDetails.length > 0){
                        for (let game of gamesDetails) {
                            if(game?.gameType == 'game_3'){
                                let game3Data = {
                                    playerId: data.playerId,
                                    parentGameId: game?.parentGameId,
                                    subGameId: game?._id,
                                    gameId: game?._id,
                                    language: data.language
                                }
                                console.log('game3Data cancelGameTickets before',game3Data);
                                await Sys.Game.Game3.Controllers.GameController.cancelGameTickets(socket, game3Data)
                                console.log("game3Data cancelGameTickets after");
                            }
                        }
                    }
                    isBreak= true;
                }
                let breakData = {
                    isBreak: isBreak,
                    startBreakTime: PlayerDetails?.startBreakTime,
                    endBreakTime: PlayerDetails?.endBreakTime
                }
                await Sys.Io.to(PlayerDetails?.socketId).emit('breakTimeStart', breakData); 
            }
            return true;
        } catch (e) {
            console.log("Error in creating data", e);
            return false;
        }
    },

    checkBreakTime: async function (playerId) {
        try {
            let PlayerDetails = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId }, {startBreakTime: 1, endBreakTime: 1});
            if(PlayerDetails){
                let curentTime = moment(new Date());
                let startBreakTime = moment(curentTime).add(1, 'hours');
                // let endBreakTime = moment(startBreakTime).add(5, 'minutes');
                //let startBreakTime = moment(curentTime).add(5, 'minutes');
                let endBreakTime = moment(startBreakTime).add(5, 'minutes');
                if(!PlayerDetails?.startBreakTime){
                    console.log('if startBreakTime');
                    PlayerDetails = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(playerId, {startBreakTime: startBreakTime, endBreakTime: endBreakTime, "otherData.originalStartBreakTime": new Date(startBreakTime) });
                    if(PlayerDetails){
                        let breakData = {
                            isBreak: false,
                            startBreakTime: PlayerDetails?.startBreakTime,
                            endBreakTime: PlayerDetails?.endBreakTime
                        }
                        await Sys.Io.to(PlayerDetails?.socketId).emit('breakTimeStart', breakData);
                    }
                }else{
                    console.log('else startBreakTime');
                    if(curentTime > PlayerDetails?.endBreakTime){
                        PlayerDetails = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(playerId, {startBreakTime: startBreakTime, endBreakTime: endBreakTime, "otherData.originalStartBreakTime": new Date(startBreakTime)});
                        if(PlayerDetails){
                            let breakData = {
                                isBreak: false,
                                startBreakTime: PlayerDetails?.startBreakTime,
                                endBreakTime: PlayerDetails?.endBreakTime
                            }
                            await Sys.Io.to(PlayerDetails?.socketId).emit('breakTimeStart', breakData);
                        }
                    }
                }
            }
        } catch (e) {
            console.log("Error in creating data", e);
        }
    },

    /**
     * Updates the break time for all players in the provided playerIds array for Game 1
     *
     * @param {string[]} playerIds - The array of player IDs
     *
     * @returns {Promise<void>}
     */
    checkBreakTimeForAllPlayers: async function (playerIds) {
        try {
            // Fetch all player details in one query
            const players = await Sys.Game.Common.Services.PlayerServices.getManyPlayerByData(
                { _id: { $in: playerIds } },
                { startBreakTime: 1, endBreakTime: 1, socketId: 1 }
            );
           
            const currentTime = moment();
            const updates = [];
            const breakDataEmits = [];
    
            // Iterate over all players and update their break time if necessary
            for (const player of players) {
                const startBreakTime = moment(currentTime).add(1, 'hours');
                const endBreakTime = moment(startBreakTime).add(5, 'minutes');
    
                // Check if the player's break time needs to be updated
                if (!player.startBreakTime || currentTime > player.endBreakTime) {
                    updates.push({
                        updateOne: {
                            filter: { _id: player._id },
                            update: { $set: { startBreakTime, endBreakTime, "otherData.originalStartBreakTime": new Date(startBreakTime) } }
                        }
                    });
    
                    // breakDataEmits.push({
                    //     socketId: player.socketId,
                    //     breakData: {
                    //         isBreak: false,
                    //         startBreakTime,
                    //         endBreakTime
                    //     }
                    // });

                    breakDataEmits.push(() =>
                        Sys.Io.to(player.socketId).emit('breakTimeStart', {
                            isBreak: false,
                            startBreakTime,
                            endBreakTime
                        })
                    );
                }
            }
            // Perform bulk update
            if (updates.length > 0) {
                await Sys.Game.Common.Services.PlayerServices.createBulkPlayers(updates);
            }
    
            // Emit break time data to players
            // for (const { socketId, breakData } of breakDataEmits) {
            //     await Sys.Io.to(socketId).emit('breakTimeStart', breakData);
            // }

            // Emit all events asynchronously
            await Promise.all(breakDataEmits.map(fn => fn()));
        } catch (e) {
            console.error("Error in checkBreakTimeForPlayers:", e);
        }
    },

    checkBreakTimeOnGameFinished: async function (playerId, gameType) {
        try {
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { startBreakTime: 1, endBreakTime: 1, socketId: 1 }
            );
    
            if (!player || !player.socketId) return true;
    
            const now = new Date();
    
            // Check if current time is within break window
            if (
                !player.startBreakTime ||
                !player.endBreakTime ||
                now < player.startBreakTime ||
                now > player.endBreakTime
            ) {
                return true;
            }
    
            // Extend break time by 5 minutes
            const startBreakTime = now;
            const endBreakTime = new Date(now.getTime() + 5 * 60 * 1000);
    
            const updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                playerId,
                { startBreakTime, endBreakTime }
            );
    
            if (updatedPlayer) {
                const breakData = {
                    isBreak: true,
                    startBreakTime,
                    endBreakTime,
                    gameType
                };
    
                Sys.Io.to(updatedPlayer.socketId).emit('breakTimeStart', breakData);
            }
    
            return true;
    
        } catch (error) {
            console.error('Error in checkBreakTimeOnGameFinished:', error);
            return false;
        }
    },
    
    updatePlayerLanguage: async function (socket, data) {
        try {
            const { playerId, language: selectedLanguage } = data;
    
            const updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId },
                { selectedLanguage }
            );
            
            if (!updatedPlayer) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "language_update_failed",
                        language: socket.languageData
                    }),
                    statusCode: 400
                };
            }
    
            socket.languageData = updatedPlayer.selectedLanguage;
    
            return {
                status: 'success',
                result: null,
                message: await translate({
                    key: "language_update_success",
                    language: updatedPlayer.selectedLanguage
                })
            };
    
        } catch (error) {
            Sys.Log.info('Error in updatePlayerLanguage : ' + error);
            return {
                status: 'fail',
                result: null,
                message: 'Internal server error',
                statusCode: 500
            };
        }
    },
    
    updatePlayerLanguageIfnotexist: async function (req, res) {
        try {
            console.log("updatePlayerLanguageIfnotexist called");
            await Sys.Game.Game1.Services.PlayerServices.updateManyData(
                { "selectedLanguage": { $exists: false } },
                { $set: { "selectedLanguage": "nor" } }
            )
            res.send({ staus: "success" })
        } catch (e) {
            console.log("update language", e)
        }
    },

    ScreenSaver: async function (socket, data) {
        try {
            return {
                status: 'success',
                result: { screenSaver: Sys.Setting.screenSaver, screenSaverTime: Sys.Setting.screenSaverTime, imageTime: Sys.Setting.imageTime },
                message: 'Screen saver response'
            }
        } catch (error) {
            return {
                status: 'success',
                result: {},
                message: 'Something went wrong'
            }
        }
    },

    // update profile images for bank id verification
    updateProfileImages: async function (req, res) {
        try {
            const {
                photoFront,
                photoBack,
                language = 'nor'
            } = req.body;
    
            const playerId = req?.player?.id;
            
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { profilePic: 1 }
            );
    
            if (!player) {
                return res.send({
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: "player_not_found",
                        language
                    }),
                    statusCode: 400
                });
            }
    
            /* -------------------- Prepare Profile Images -------------------- */
            const profilePic = Array.isArray(player.profilePic)
                ? [...player.profilePic]
                : [];
    
            /* -------------------- Update Images -------------------- */
            if (photoFront) {
                profilePic[0] = await handleImageUpdate(
                    player,
                    photoFront,
                    0,
                    language
                );
            }
    
            if (photoBack) {
                profilePic[1] = await handleImageUpdate(
                    player,
                    photoBack,
                    1,
                    language
                );
            }
    
            /* -------------------- Save Changes -------------------- */
            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                playerId,
                { $set: { profilePic } }
            );
            
            return res.send({
                status: 'success',
                result: {
                    photoFront: profilePic[0] || null,
                    photoBack: profilePic[1] || null
                },
                message: await translate({
                    key: "profile_update_success",
                    language,
                    isDynamic: true,
                    profilePic
                })
            });
    
        } catch (error) {
            Sys.Log.info('Error in updateProfileImages : ' + error);
    
            return res.send({
                status: 'fail',
                result: null,
                message: await translate({
                    key: "something_went_wrong",
                    language: req?.body?.language || 'nor'
                }),
                statusCode: 500
            });
        }
    },    

    //bank id verification,  //verifyByBankId, depositMoneyByVerifone
    verifyByBankId: async function(socket, data){
        const language = data.language || 'nor';
        try{
            const playerId = data.playerId;
            if (!playerId) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'Player ID is missing',
                    statusCode: 400
                };
            }
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId }, { username: 1, bankIdAuth: 1 });
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), //'Player Not found',
                    statusCode: 400
                }
            }
            const { isVerifiedByBankID, isBankIdReverificationNeeded } = await playerVerificationStatus(player);
            console.log("isVerifiedByBankID", isVerifiedByBankID, isBankIdReverificationNeeded)
            if(isVerifiedByBankID == true && isBankIdReverificationNeeded == false){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "bankid_already_verified", language: language }), //'Player Not found',
                    statusCode: 400
                }
            }
            const authHeader = `Basic ${Buffer.from(`${config.idkollan_api_key}:${config.idkollan_secret}`).toString('base64')}`;
            const refId = uuidv4();
            const redirectUrl = config.idkollan_redirect_url;
            // Prepare the request payload
            const payload = {
                requestSsn: true,
                requestEmail: true,
                requestPhone: true,
                requestAddress: true,
                refId: refId,
                redirectUrl: redirectUrl
            };
    
            // Make the POST request to the BankID API
            const response = await axios.post(`${config.idkollan_url}v3/bankid-no/auth`, payload, {
                headers: {
                    Authorization: authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.data) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "something_went_wrong", language: language }), // 'Something went wrong...',
                    statusCode: 400
                };
            }

            // Extract relevant data from the response
            const { id, refId: responseRefId, status, url } = response.data;

            if (!id || !responseRefId || !status) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "something_went_wrong", language: language }), // 'Something went wrong...',
                    statusCode: 400
                };
            }

            // Update player data
            let updateData = {};

            if (player?.bankIdAuth?.status === "COMPLETED" && isBankIdReverificationNeeded === true) {
                updateData['bankIdAuth.reverifyDetails'] = {
                    id: id,
                    refId: responseRefId,
                    status: status,
                    url: url,
                };
            } else {
                updateData = {
                    'bankIdAuth.id': id,
                    'bankIdAuth.refId': responseRefId,
                    'bankIdAuth.status': status,
                    'bankIdAuth.url': url,
                };
            }

            await Sys.Game.Common.Services.PlayerServices.update(playerId, {
                $set: updateData
            });

            // Output or process the response data as needed
            console.log(`Authentication initiated. ID: ${id}, RefID: ${responseRefId}, Status: ${status}, URL: ${url}`);
            
            //const finalUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].url}player/bankId/iframe/${id}`;
            //console.log("Iframe Url", finalUrl)
            // Return success response
            return {
                status: 'success',
                result:  url,
                message: "Authentication initiated",
                statusCode: 200
            };
            
      
        }catch(e){
            console.log("Error in bank Id link generation", e)
            e?.errors?.forEach((err, index) => {
                console.log(`Error ${index + 1}:`, err.message);
            });
            return {
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), // 'Something went wrong...',
                statusCode: 400
            };
        }
    },
   
    // Bank Id Iframe redirection, not used, if we have to open in iframe then we need to use
    bankIdIframe: async function (req, res) {
        const reponsePage = "player/bankId/reponse";
        try {
            console.log("bank id", req.params.id);
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ 'bankIdAuth.id': req.params.id }, { selectedLanguage: 1, bankIdAuth: 1 });
            const playerLanguage = player?.playerLanguage;
            if (player?.bankIdAuth?.status == "PENDING") {
                return res.render('player/bankId/verify.html', { status: "pending", message: "Please Procees to Verify.", url: player?.bankIdAuth?.url, title: "", goBack: await translate({ key: "goBackbutton", language: player.selectedLanguage }) });
            } else if (player?.bankIdAuth?.status == "COMPLETED") {
                return renderSuccessResponse(res, reponsePage, playerLanguage, "bankId_verification_success_msg", "bankId_verification_success_title");
            } else if (player?.bankIdAuth?.status == "FAILED") {
                return renderErrorResponse(res, reponsePage, playerLanguage, "bankId_verification_failed_msg", "bankId_verification_failed_title");
            } else {
                return renderErrorResponse(res, reponsePage, playerLanguage, "bankId_verification_failed_msg", "bankId_verification_failed_title");
            }
        } catch (error) {
            console.log("Error in verifoneIframe:", error);
        }
    },

    // idkollen bankid redirect url
    verifyPlayerBankId: async function (req, res) {
        const language = req.query.language || 'en'; // Use req.query for language
        const reponsePage = "player/bankId/reponse"; // Define the response page
        let isDisplayGoBackBtn = false;
        try {
            console.log('Request query in verifyPlayerBankId:', req.query);
    
            // Extract id and refId from query parameters
            const { id, refId } = req.query;
    
            // Validate id and refId
            if (!id || !refId) {
                return renderErrorResponse(res, reponsePage, language, "something_went_wrong", "bankId_verification_failed_title", isDisplayGoBackBtn);
            }
    
            // Fetch player data based on bankIdAuth.id and bankIdAuth.refId
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { 
                    $or: [
                        { 'bankIdAuth.id': id, 'bankIdAuth.refId': refId },
                        { 'bankIdAuth.reverifyDetails.id': id, 'bankIdAuth.reverifyDetails.refId': refId }
                    ]
                },
                { username: 1, bankIdAuth: 1, selectedLanguage: 1, platform_os: 1 }
            );
            
            // Validate player existence
            if (!player) {
                return renderErrorResponse(res, reponsePage, language, "player_not_found", "bankId_verification_failed_title", isDisplayGoBackBtn);
            }

            if(player.platform_os != "webgl"){
                isDisplayGoBackBtn = true;
            }
    
            const playerId = player._id; // Extract playerId for database update
            const playerLanguage = player.selectedLanguage || language; // Use player's selected language
    
            // Prepare authentication header
            const authHeader = `Basic ${Buffer.from(`${config.idkollan_api_key}:${config.idkollan_secret}`).toString('base64')}`;
    
            // Fetch BankID verification status from the API
            const response = await axios.get(`${config.idkollan_url}v3/bankid-no/auth/${id}`, {
                headers: {
                    Authorization: authHeader,
                    'Content-Type': 'application/json'
                }
            });
    
            console.log("BankID API response:", response.data);
    
            // Validate API response
            if (!response?.data) {
                return renderErrorResponse(res, reponsePage, playerLanguage, "something_went_wrong", "bankId_verification_failed_title", isDisplayGoBackBtn);
            }
    
            const { status, ssn, name, givenName, surname, birthDate, email, phone, address, bankId, error } = response.data;
    
            const updateData = {};
            const unsetData = {};

            if (status === 'COMPLETED') {
                Object.assign(updateData, {
                    'bankIdAuth.id': id,
                    'bankIdAuth.refId': refId,
                    'bankIdAuth.url': player?.bankIdAuth?.reverifyDetails?.url ?? player?.bankIdAuth?.url,
                    'bankIdAuth.status': status,
                    'bankIdAuth.ssn': ssn,
                    'bankIdAuth.name': name,
                    'bankIdAuth.givenName': givenName,
                    'bankIdAuth.surname': surname,
                    'bankIdAuth.birthDate': birthDate,
                    'bankIdAuth.email': email,
                    'bankIdAuth.phone': phone,
                    'bankIdAuth.address': address,
                    'bankIdAuth.bankId': bankId,
                    'bankIdAuth.reverifyDetails': {}, // reset or clear
                    'bankIdAuth.remindersSent': [],
                });

                if (player?.bankIdAuth?.expiryDate) {
                    unsetData['bankIdAuth.expiryDate'] = '';
                }

            } else {
                const { isVerifiedByBankID, isBankIdReverificationNeeded } = await playerVerificationStatus(player);

                if (isVerifiedByBankID || isBankIdReverificationNeeded) {
                    updateData['bankIdAuth.reverifyDetails.status'] = status;
                } else {
                    updateData['bankIdAuth.status'] = status;
                }
            }

            const updateQuery = {
                $set: updateData,
                ...(Object.keys(unsetData).length > 0 && { $unset: unsetData })
            };

            console.log("bank id update bankid data--", updateQuery);

            // Perform DB update
            const updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId },
                updateQuery
            );


            if (status === 'COMPLETED') {
                // Get player verification status
                const { isVerifiedByBankID, isVerifiedByHall, canPlayGames, isBankIdReverificationNeeded, idExpiryDate } = await playerVerificationStatus(updatedPlayer);
                // Send broadcast when verification status update
                if(updatedPlayer.socketId){
                    await Sys.Io.to(updatedPlayer.socketId).emit('playerVerificationStatus', {
                        isVerifiedByBankID,
                        isVerifiedByHall,
                        canPlayGames,
                        isBankIdReverificationNeeded,
                        idExpiryDate
                    });
                }
            }
            
    
            console.log(`Player ${playerId} bankIdAuth updated with status: ${status}`);

            // Handle different BankID verification statuses
            switch (status) {
                case 'COMPLETED':
                    return renderSuccessResponse(res, reponsePage, playerLanguage, "bankId_verification_success_msg", "bankId_verification_success_title", isDisplayGoBackBtn);
    
                case 'FAILED':
                    return renderErrorResponse(res, reponsePage, playerLanguage, "bankId_verification_failed_msg", "bankId_verification_failed_title", isDisplayGoBackBtn);
    
                case 'PENDING':
                    return renderPendingResponse(res, reponsePage, playerLanguage, "bankId_verification_pending_msg", "bankId_verification_pending_title", isDisplayGoBackBtn);
    
                default:
                    return renderPendingResponse(res, reponsePage, playerLanguage, "bankId_verification_pending_msg", "bankId_verification_pending_title", isDisplayGoBackBtn);
            }
    
        } catch (e) {
            console.error("Error in verifyPlayerBankId:", e);
            return renderErrorResponse(res, reponsePage, language, "something_went_wrong", "bankId_verification_failed_title", isDisplayGoBackBtn);
        }
    },

    goBacktoAppFromBankId: async function(req, res){
        try {
            const { id, refId } = req.body;
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                { 
                    $or: [
                        { 'bankIdAuth.id': id, 'bankIdAuth.refId': refId },
                        { 'bankIdAuth.reverifyDetails.id': id, 'bankIdAuth.reverifyDetails.refId': refId }
                    ]
                },
                { socketId: 1 }
            );
            console.log("goBacktoAppFromBankId id and player", req.body, req.body.id, player)
            if (player) {
                await Sys.Io.to(player.socketId).emit('closePaymentPage', {});
                return res.send({ status: "success", message: "Broadcast sent successfully.", url: "" });
            } else {
                return res.send({ status: "failed", message: "Something went wrong.", url: "" });
            }
        } catch (error) {
            console.log("Error in go back to app from bank id:", error);
        }
    },

    myWinnings: async function (socket, data) {
        let { playerId, game_type, filter_by,  date, language = "en"} = data;
        try {
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId }, { hall: 1, selectedLanguage: 1, startBreakTime: 1, endBreakTime: 1, otherData: 1});
            if (!player) {
                return { status: "fail", result: null, message: await translate({ key: "player_not_found", language }), statusCode: 400 };
            }
            language = player.selectedLanguage;

            let startDate = null, endDate = null; // Default values
            if(filter_by == "date"){
                //Validate and parse date
                const formattedDate = moment(date, 'YYYY-M-D').format('YYYY-MM-DD');
                if (!moment(formattedDate, "YYYY-MM-DD", true).isValid()) {
                    return { status: "fail", result: null, message: await translate({ key: "invalid_date_format", language }), statusCode: 400 };
                }
                startDate = moment(formattedDate).startOf("day").toDate();
                endDate = moment(formattedDate).endOf("day").toDate();
            }  else if (player?.startBreakTime) {
                const endBreakTime = moment(player?.endBreakTime);
                if (endBreakTime.isValid() && endBreakTime.isAfter(moment())) {
                    startDate = moment(player.startBreakTime).subtract(62, "minutes").toDate();
                    endDate = new Date(player.startBreakTime); endDate.setSeconds(59);
                    if(player?.otherData?.originalStartBreakTime){
                        startDate = moment(player?.otherData?.originalStartBreakTime).subtract(60, "minutes").seconds(0).toDate();
                    }
                }
            }
            console.log("start and end date---", startDate, endDate)
            if(startDate == null || endDate == null){
                let myWinnings = {
                    totalBet: 0,
                    totalwinn: 0,
                    lossProfit: 0,
                };
                return { status: "success", result: myWinnings, message: "My Winnings" };
            }

            // Construct match condition
            let matchCondition = {
                playerId,
                hallId: player.hall.id,
                defineSlug: { "$nin": ["loyalty", "leaderboard"] },
                isBotGame: false,
                gameType: { "$exists": true, "$ne": "" },
                userType: "Online",
            };

            // Add date filtering based on game type
            if (game_type !== "all") {
                matchCondition.gameType = game_type;
                if (["game_1", "game_2", "game_3"].includes(game_type)) {
                    matchCondition["otherData.exactGameStartTime"] = { "$gte": startDate, "$lte": endDate };
                } else if (["game_4", "game_5"].includes(game_type)) {
                    matchCondition["gameStartDate"] = { "$gte": startDate, "$lte": endDate };
                }
            } else {
                matchCondition["$or"] = [
                    // { "otherData.exactGameStartTime": { "$gte": startDate, "$lte": endDate } },
                    // { "gameStartDate": { "$gte": startDate, "$lte": endDate } }
                    { 
                        "gameType": { "$in": ["game_1", "game_2", "game_3"] },
                        "otherData.exactGameStartTime": { "$gte": startDate, "$lte": endDate }
                    },
                    { 
                        "gameType": { "$in": ["game_4", "game_5"] },
                        "gameStartDate": { "$gte": startDate, "$lte": endDate }
                    }
                ];
            }

            // Aggregation pipeline
            const pipeline = [
                { "$match": matchCondition },
                {
                    "$group": {
                        "_id": null,
                        "totalBuy": {
                            "$sum": {
                                "$cond": [
                                    { "$or": [
                                        { "$eq": ["$game1Slug", "buyTicket"] },
                                        { "$eq": ["$defineSlug", "buyTicket"] },
                                        { "$and": [{ "$eq": ["$gameType", "game_5"] }, { "$eq": ["$typeOfTransaction", "Game Joined"] }] },
                                        { "$eq": ["$game1Slug", "replaceTicket"] }
                                    ]}, "$typeOfTransactionTotalAmount", 0
                                ]
                            }
                        },
                        "totalCancel": {
                            "$sum": {
                                "$cond": [
                                    { "$or": [
                                        { "$eq": ["$game1Slug", "cancelTicket"] },
                                        { "$eq": ["$defineSlug", "cancelTicket"] },
                                        { "$eq": ["$game1Slug", "refund"] },
                                    ]}, "$typeOfTransactionTotalAmount", 0
                                ]
                            }
                        },
                        "totalWinning": { "$sum": "$winningPrice" }
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "totalBet": { "$subtract": ["$totalBuy", "$totalCancel"] },
                        "totalWinning": 1
                    }
                }
            ];

            // Execute aggregation query
            const result = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(pipeline);

            // Construct response
            const myWinnings = result.length > 0 ? {
                totalBet: result[0].totalBet || 0,
                totalwinn: result[0].totalWinning || 0,
                lossProfit: (result[0].totalWinning || 0) - (result[0].totalBet || 0)
            } : { totalBet: 0, totalwinn: 0, lossProfit: 0 };

            return { status: "success", result: myWinnings, message: "My Winnings" };

        } catch (e) {
            Sys.Log.info('Error in getting player my winnings : ' + e);
        }
    },

    // get available and existing block rules in application setting page
    playerSettings: async function(socket, data){
        const { playerId, language } = data;
        try {
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId }, { blockRules: 1, approvedHalls: 1, selectedLanguage: 1, otherData: 1 });
           
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }

            const allHalls = player?.approvedHalls?.length > 0
                ? player.approvedHalls
                    .filter(hall => hall.status === 'Approved')
                    .map(hall => hall.id)
                : [];

            // get available and existing block rules
            const { availableBlockOptions, existingBlockRules } = await getExistingAndAvailableBlockRules(allHalls, player?.blockRules);
            
            const confirmationMessage = {
                en: "This is an irreversible action and cannot be lifted. Once set, the player will only be able to resume play after the specified time. The player will not be able to update or remove this option during this period.",
                nor: "Dette er en irreversibel handling og kan ikke oppheves. Når den er satt, vil spilleren først kunne fortsette å spille etter den angitte tiden. Spilleren vil ikke kunne oppdatere eller fjerne dette valget i løpet av denne perioden."
            }

            return await createSuccessResponse(
                {
                    availableBlockOptions,
                    existingBlockRules,
                    confirmationMessage,
                    isSoundOn: player?.otherData?.isSoundOn || 0, //0: false, 1: true
                    isVoiceOn: player?.otherData?.isVoiceOn || 0, //0: false, 1: true
                    selectedVoiceLanguage: player?.otherData?.selectedVoiceLanguage || 0, //0: norway_men, 1: norway_women, 2: english
                },
                "Player Settings", player.selectedLanguage, false
            );

        } catch (e) {
            console.log("Error in getting player settings : ", e);
            return await createErrorResponse("something_went_wrong", language, 500, true);
        }
    },

    // add or update block rule in application setting page
    addOrUpdateBlockRule: async function(socket, data){
        const { playerId, newRules, language } = data;
        try {
            const newRulesFinal = JSON.parse(newRules).list;
            console.log("newRules in addOrUpdateBlockRule", newRulesFinal, typeof newRulesFinal);

            const player = await Sys.Game.Game2.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { blockRules: 1, approvedHalls: 1 }
            );
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
            
            // players all approved halls
            const allHalls = player?.approvedHalls?.length > 0
                ? player.approvedHalls
                    .filter(hall => hall.status === 'Approved')
                    .map(hall => hall.id)
                : [];
            let blockRules = player?.blockRules;
            
            const updatedBlockRules = await addOrUpdateBlockRule(blockRules, allHalls, newRulesFinal);
            if(updatedBlockRules){
                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({
                    _id: playerId
                }, {
                    blockRules: updatedBlockRules
                });
                blockRules = updatedBlockRules;
            }

            // On submit send updated avaibale and existing block rules in response
            const { availableBlockOptions, existingBlockRules } = await getExistingAndAvailableBlockRules(allHalls, blockRules);
            
            return {
                status: 'success',
                result: { availableBlockOptions, existingBlockRules },
                message: await translate({ key: "block_rule_added_successfully", language: language }),
                statusCode: 200
            };
        } catch (e) {
            Sys.Log.info('Error in adding or updating block rule : ' + e);
            return await createErrorResponse("something_went_wrong", language, 500, true);
        }
    },

    // remove expired block rules by cron
    updatePlayerBlockRules: async function () {
        try {
            const result = await Sys.Game.Game3.Services.PlayerServices.updateManyPlayerData(
                {},
                {
                    $pull: {
                        blockRules: {
                            endDate: { $lt: new Date() }
                        }
                    }
                }
            );
            console.log("Expired block rules removed:", result?.modifiedCount || result?.nModified || 0);
            return true;
        } catch (e) {
            console.log("Error in updating player block rules:", e);
            return false;
        }
    },

    refreshAccessToken: async function(socket, data){
        try{
            const { playerId, refreshToken, language } = data || {};
            
            if (!playerId || !refreshToken) {
                return await createErrorResponse("something_went_wrong", language, 400, true);
            }

            const player = await Sys.Game.Game2.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { 'otherData.refreshAuthToken': 1 }
            );

            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }

            const storedRefresh = player?.otherData?.refreshAuthToken;
            if (!storedRefresh || storedRefresh !== refreshToken) {
                return await createErrorResponse("invalid_credentials", language, 401, true);
            }

            try {
                jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
            } catch (err) {
                return await createErrorResponse("invalid_credentials", language, 401, true);
            }

            const [authToken, refreshAuthToken] = await Promise.all([
                generateAuthToken(player._id, '1d', jwtcofig.secret),
                generateAuthToken(player._id, '7d', process.env.JWT_REFRESH_SECRET),
            ]);

            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
                { _id: playerId },
                { 'otherData.authToken': authToken, 'otherData.refreshAuthToken': refreshAuthToken }
            );

            return await createSuccessResponse({ authToken, refreshAuthToken }, "Token refreshed Successfully", language, false);
        }catch(e){
            console.log("Error in refresh token", e)
            return await createErrorResponse("something_went_wrong", socket?.languageData || 'nor', 500, true);
        }
    },

    switchHall: async function(socket, data) {
        try {
            console.log("switch hall called--", data)
            const { hallId, playerId, language } = data;
        
            // Early validation for required fields
            if (!hallId?.trim() || !playerId?.trim()) {
                return await createErrorResponse("something_went_wrong", language, 400, true);
            }

            // get player and hall based ip in parallel
            const [player, hallBasedIp] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getOneByData({ _id: playerId }, { status: 1, userType: 1, hall: 1, walletAmount: 1, selectedLanguage: 1, bankIdAuth: 1, isVerifiedByHall: 1, isVerifiedByBankID: 1, approvedHalls: 1, socketId: 1 }),
                // Sys.App.Services.HallServices.getSingleHallData(
                //     { ip: getPlayerIp({ handshake: { headers: socket.handshake.headers }, conn: { remoteAddress: socket.conn.remoteAddress }}) },
                //     { name: 1, groupHall: 1 }
                // )
            ]);

            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
    
            // if(hallBasedIp){
            //     return await createErrorResponse("can_not_switch_hall_from_terminal", language, 400, true);
            // }
    
            // Process hall switching using the same logic as playerLogin
            const hallResult = await processPlayerHall(player, hallId, null);
            if (!hallResult.success) {
                if(hallResult?.error?.isDynamic){
                    return await createErrorResponse(hallResult.error.key, language, 400, true, null, null, true, hallResult.error.numbers);
                }
                return await createErrorResponse(hallResult.error.key, language, 400, true);
            }
    
            const currentHall = hallResult.hall;
            const currentGroupHall = hallResult.groupHall;
    
            // Update player's hall information
            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({
                _id: player._id
            }, {
                hall: currentHall,
                groupHall: currentGroupHall
            });
    
            // Return success response with updated hall information
            return await createSuccessResponse(
                {
                    playerId: player._id.toString(),
                    hall: currentHall.id,
                    hallName: currentHall.name,
                    realMoney: +player.walletAmount.toFixed(2)
                },
                "Hall switched successfully!", 
                language, 
                false
            );
    
        } catch (error) {
            console.error('Switch Hall Error:', error);
            return await createErrorResponse("something_went_wrong", socket.languageData || 'nor', 500, true);
        }
    },

    playerHallLimit: async function(socket, data) {
        try {
            const { playerId, language } = data;
        
            // Early validation for required fields
            if (!playerId?.trim()) {
                return await createErrorResponse("something_went_wrong", language, 400, true);
            }

            // get player and hall based ip in parallel
            const player = await Sys.Game.Game2.Services.PlayerServices.getOneByData({ _id: playerId }, { approvedHalls: 1, hall: 1 });

            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
        
            const approvedHalls = await getAvailableHallLimit({ playerId: player._id, approvedHalls: player?.approvedHalls, selectedHallId: player?.hall?.id });
            
            // Return success response with updated hall information
            return await createSuccessResponse(
                { approvedHalls },
                "Player Limited fetched successfully!", 
                language, 
                false
            );
        } catch (error) {
            console.error('playerHallLimit Error:', error);
            return await createErrorResponse("something_went_wrong", socket.languageData || 'nor', 500, true);
        }
    },

    CheckForRefundAmount: async function (socketId, data) {
        try {
            console.log("CheckForRefundAmount called--",data);
            if (!socketId || !data?.playerId || !data?.gameId || !data?.hallIds?.length) return false;
    
            // Fetch player & game in parallel
            const [player, game] = await Promise.all([
                Sys.Game.Common.Services.PlayerServices.getOneByData(
                    { _id: data.playerId },
                    { _id: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Common.Services.GameServices.getSingleGameData(
                    { _id: data.gameId, status: "active" },
                    { _id: 1, gameType: 1 }
                )
            ]);
    
            if (!player || !game) return false;
    
            const basePayload = {
                playerId: data.playerId,
                hallIds: data?.hallIds || null,
                language: player.selectedLanguage
            };
    
            // Map game type → controller
            const gameControllerMap = {
                game_1: {
                    controller: Sys.Game.Game1.Controllers.GameController,
                    payload: { ...basePayload, gameId: game._id, isRefund: true }
                },
                game_2: {
                    controller: Sys.Game.Game2.Controllers.GameController,
                    payload: { ...basePayload, subGameId: game._id, isRefund: true }
                },
                game_3: {
                    controller: Sys.Game.Game3.Controllers.GameController,
                    payload: { ...basePayload, subGameId: game._id, isRefund: true }
                }
            };
    
            const gameConfig = gameControllerMap[game.gameType];
            if (!gameConfig) return false;
            await gameConfig.controller.cancelGameTickets(
                socketId,
                gameConfig.payload
            );
    
            return true;
    
        } catch (error) {
            console.error("CheckForRefundAmount error:", error);
            return false;
        }
    },
    
    playerSoundAndVoiceSettings: async function (socket, data) {
        try {
            const { playerId, settingType, language } = data;
            let settingValue = data.settingValue;
            
            const player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId }, { username: 1, otherData: 1 });

            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
            // Initialize otherData if it doesn't exist
            let otherData = player.otherData || {};
            
            // Update the specific setting based on settingType
            let updateData = {};
            let successMessage = '';
            
            switch (settingType) {
                case 'sound':
                    // Sound on/off (boolean)
                    otherData.isSoundOn = settingValue; //0: false, 1: true
                    successMessage = 'Sound Setting Updated Successfully';
                    break;
                    
                case 'voice':
                    // Voice on/off (boolean)
                    otherData.isVoiceOn = settingValue; //0: false, 1: true
                    successMessage = 'Voice Setting Updated Successfully';
                    break;
                    
                case 'voiceLanguage':
                    // Voice language selection (string) - only allowed values
                    //const allowedVoiceLanguages = ['english', 'norway_men', 'norway_women'];
                    
                    // If no value provided or invalid value, set default
                    // if (!settingValue || !allowedVoiceLanguages.includes(settingValue)) {
                    //     settingValue = 'norway_women'; // default value
                    // }
                    
                    otherData.selectedVoiceLanguage = settingValue;
                    successMessage = 'Voice Language Updated Successfully';
                    break;
                    
                default:
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ 
                            key: "something_went_wrong", 
                            language: language 
                        }),
                        statusCode: 400
                    }
            }
            
            updateData.otherData = otherData;
            
            // Update player in database
            let updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                playerId, 
                updateData
            );
            
            if (updatedPlayer) {
                return {
                    status: 'success',
                    result: {
                        settingType: settingType,
                        value: settingValue,
                        otherData: { 
                            isSoundOn: updatedPlayer?.otherData?.isSoundOn || 0, //0: false, 1: true
                            isVoiceOn: updatedPlayer?.otherData?.isVoiceOn || 0, //0: false, 1: true
                            selectedVoiceLanguage: updatedPlayer?.otherData?.selectedVoiceLanguage || 0  //0: norway_men, 1: norway_women, 2: english
                        }
                    },
                    message: successMessage,
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ 
                        key: "something_went_wrong", 
                        language: language 
                    }), 
                    statusCode: 400
                }
            }
            
        } catch (error) {
            return {
                status: 'fail',
                result: null,
                message: await translate({ 
                    key: "something_went_wrong", 
                    language: data?.language 
                }), 
                statusCode: 500
            }
        }
    },

    // This functions are not used by the system
    
    // loginWithUniqueId: async function (socket, data) {
    //     try {
    //         let language = "nor";
    //         if (data.language) {
    //             language = data.language;
    //         }
    //         if (!data.os || !data.appVersion) {
    //             return {
    //                 status: 'fail',
    //                 result: { storeUrl: "", message: "", disable_store_link: true, playerId: "", hall: "", hallName: "", points: 0, realMoney: 0 },
    //                 message: await translate({ key: "update_app", language: language }), // "Hey there! We've just released a new update for the app which includes some great new features - so make sure you force update the app to get the latest and greatest!",
    //                 statusCode: 401
    //             }
    //         } else {
    //             // if ((data.os == 'android' && data.appVersion >= Sys.Setting.android_version) || (data.os == 'iOS' && data.appVersion >= Sys.Setting.ios_version) || (data.os == 'other' && data.appVersion >= Sys.Setting.wind_linux_version)) {
    //             if ((data.os == 'android' && data.appVersion >= Sys.Setting.android_version) || (data.os == 'iOS' && data.appVersion >= Sys.Setting.ios_version) || (data.os == 'windows' && data.appVersion >= Sys.Setting.wind_linux_version) || (data.os == 'webgl' && data.appVersion >= Sys.Setting.webgl_version) || (data.os == 'other' && data.appVersion >= Sys.Setting.wind_linux_version)) {
    //                 console.log("valid version found", data.os, data.appVersion, Sys.Setting.android_version, Sys.Setting.ios_version, Sys.Setting.wind_linux_version);
    //             } else {
    //                 let storeUrl = '';
    //                 if (Sys.Setting.disable_store_link == "No") {
    //                     if (data.os == 'android') {
    //                         storeUrl = Sys.Setting.android_store_link;
    //                     } else if (data.os == 'iOS') {
    //                         storeUrl = Sys.Setting.ios_store_link;
    //                     } else {
    //                         storeUrl = Sys.Setting.windows_store_link;
    //                     }
    //                 }
    //                 return {
    //                     status: 'fail',
    //                     result: { storeUrl: storeUrl, message: await translate({ key: "update_app", language: language }), disable_store_link: (Sys.Setting.disable_store_link == "Yes") ? true : false, playerId: "", hall: "", hallName: "", points: 0, realMoney: 0 },
    //                     message: 'updateApp',
    //                     statusCode: 401
    //                 }
    //             }
    //         }
    //         let passwordTrue = true;
    //         let player = null;

    //         let playerObj = {
    //         };
    //         if (data.id != undefined) {
    //             playerObj.username = data.id;
    //         }
    //         console.log('playerObj of UniqueId: ', playerObj);

    //         player = await Sys.Game.Common.Services.PlayerServices.getOneByData(playerObj);
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "uniqueid_not_found", language: language }), // 'Unique Id not found, please Enter Valid Id',
    //                 statusCode: 400
    //             }
    //         }

    //         if (player.status != 'active') {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "blocked", language: language }), // 'Oops You are Blocked,please Contact Administrator.',
    //                 statusCode: 400
    //             }
    //         }
    //         console.log("date", player.uniqueExpiryDate, new Date())
    //         if (player.uniqueExpiryDate <= new Date()) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "uniqueid_expired", language: language }), // 'Your Unique Id is Expired, please Contact Administrator.',
    //                 statusCode: 400
    //             }
    //         }

    //         if (player.isDailyAttendance == false) {

    //             await Sys.Game.Common.Services.PlayerServices.updatePlayerData({
    //                 _id: player.id
    //             }, {
    //                 isDailyAttendance: true
    //             });

    //             let dataSlug = await Sys.App.Services.LoyaltyService.getByDataLoyalty({ slug: "dailyAttendance" });

    //             if (dataSlug.length > 0) {
    //                 let transactionDataSend = {
    //                     playerId: player.id,
    //                     loyaltyId: dataSlug[0]._id,
    //                     transactionSlug: "loyalty",
    //                     action: "credit", // debit / credit
    //                     purchasedSlug: "points", // point /realMoney
    //                     totalAmount: dataSlug[0].points,
    //                 }

    //                 await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
    //             }
    //         }

    //         if (passwordTrue) {

    //             console.log("data.forceLogin UniqueId", data.forceLogin);
    //             if (data.forceLogin) {
    //                 if (player.socketId) {
    //                     console.log("Player Force Logout Send UniqueId.");
    //                     await Sys.Io.to(player.socketId).emit('ForceLogout', {
    //                         playerId: player.id,
    //                         message: await translate({ key: "logout_as_login", language: language }), //"You are logged off due to login from another device.",
    //                     });
    //                 }
    //             } else {
    //                 //console.log("socketids-----", player.socketId, socket.id)
    //                 console.log("", Sys.Io.sockets.connected[player.socketId]);
    //                 if (Sys.Io.sockets.connected[player.socketId] && player.socketId != socket.id) {
    //                     console.log("socket is already connected UniqueId");
    //                     return {
    //                         status: 'fail',
    //                         message: 'alreadyLogin',
    //                     }
    //                 }
    //             }

    //             if (player.socketId) {
    //                 console.log("Player Force Logout Send UniqueId.")
    //                 await Sys.Io.to(player.socketId).emit('ForceLogout', {
    //                     playerId: player.id,
    //                     message: await translate({ key: "logout_as_login", language: language }), //"You are logged off due to login from another device.",
    //                 });
    //             }

    //             await Sys.Game.Common.Services.PlayerServices.updatePlayerData({
    //                 _id: player.id
    //             }, {
    //                 socketId: socket.id,
    //                 firebaseToken: "", //data.firebaseToken,
    //                 platform_os: data.os,
    //                 device_id: data.deviceId,
    //                 selectedLanguage: (!player.selectedLanguage) ? language : player.selectedLanguage
    //             });

    //             console.log("player socket id on login UniqueId", socket.id, player.username);
    //             let blockData = {
    //                 "list": [0, 1, 30, 90, 180, 365],
    //                 "index": 0
    //             }
    //             let hallList = [player.hall.id];
    //             // if (player.hall.length > 0) {
    //             //     for (let h = 0; h < player.hall.length; h++) {
    //             //         if (player.hall[h].status == "Approved") {
    //             //             hallList.push(player.hall[h].name);
    //             //         }
    //             //     }
    //             // }

    //             socket.languageData = (!player.selectedLanguage) ? language : player.selectedLanguage;

    //             return {
    //                 status: 'success',
    //                 result: {
    //                     playerId: player.id,
    //                     username: player.username,
    //                     points: player.points,
    //                     realMoney: player.walletAmount.toFixed(2),
    //                     blockData: blockData,
    //                     enableNotification: player.enableNotification,
    //                     profilePic: player.profilePic,
    //                     hallList: hallList,
    //                     isUniqueIdPlayer: true,
    //                     screenSaver: Sys.Setting.screenSaver,
    //                     screenSaverTime: Sys.Setting.screenSaverTime,
    //                     imageTime: Sys.Setting.imageTime
    //                 },
    //                 message: 'Player Successfully Login!'
    //             }
    //         }

    //     } catch (error) {
    //         Sys.Log.info('Error in Login login of UniqueId : ', error);
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: await translate({ key: "internal_server_error", language: data.language }), //'Server Error.',
    //             statusCode: 400
    //         }
    //     }
    // },

    // depositMoney: async function (socket, data, cb) {
    //     try {
    //         console.log("depositMoney data", data);

    //         if (!data.amount || data.amount < 0) {
    //             return cb({ "status": "fail", "message": "Please Enter Deposit Doller" });
    //         }

    //         var message, transactionID, paymentBaseUrl;
    //         let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId });
    //         if (player) {
    //             var ID = Date.now()
    //             var orderNumber = await Sys.Helper.bingo.ordNumFunction(ID);
    //             let randomNumber = Math.floor(100000 + Math.random() * 900000);

    //             var options = {
    //                 method: 'GET',
    //                 url: Sys.Config.App[Sys.Config.Database.connectionType].payment.registerurl,
    //                 qs: {
    //                     merchantId: Sys.Config.App[Sys.Config.Database.connectionType].payment.merchantId,
    //                     token: Sys.Config.App[Sys.Config.Database.connectionType].payment.token,
    //                     orderNumber: 'ORD' + orderNumber + '' + randomNumber,
    //                     amount: parseInt(data.amount),
    //                     CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].payment.CurrencyCode,
    //                     redirectUrl: Sys.Config.App[Sys.Config.Database.connectionType].payment.redirectUrl
    //                 },
    //             };

    //             var apiCalling = await Sys.Helper.bingo.paymentGetAPI(options);

    //             console.log(" depositMoney request apiCalling", apiCalling);

    //             var ast = XmlReader.parseSync(apiCalling.data);

    //             console.log("response body ast", xmlQuery(ast).children());
    //             var errorType = xmlQuery(ast).children().find('Error').attr('xsi:type');
    //             console.log("response body errorType", errorType);

    //             if (errorType) {
    //                 var errorSection = 'Register';
    //                 var dataSend = {
    //                     playerId: player.id,
    //                     orderNumber: options.qs.orderNumber,
    //                     amount: parseInt(data.amount),
    //                 }
    //                 var errorCheck = await Sys.Helper.bingo.errorCheck(errorType, errorSection, ast, dataSend);
    //                 return cb({
    //                     status: 'fail',
    //                     result: null,
    //                     message: "Sorry Payment Process not proceed forward"
    //                 })
    //             } else {
    //                 transactionID = xmlQuery(ast).find('TransactionId').text();
    //                 console.log("***************************************************************************");
    //                 console.log(" depositMoney response body transactionID", transactionID);
    //                 console.log("***************************************************************************");
    //                 if (transactionID !== null) {
    //                     paymentBaseUrl = 'https://test.epayment.nets.eu/Terminal/default.aspx?merchantId=' + Sys.Config.App[Sys.Config.App.connectionType].payment.merchantId + '&transactionId=' + transactionID + '';

    //                     let deposit = await Sys.App.Services.depositMoneyServices.insertData({
    //                         playerId: await Sys.Helper.bingo.obId(player.id),
    //                         playerName: player.username,
    //                         orderNumber: options.qs.orderNumber,
    //                         amount: parseInt(data.amount),
    //                         CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].payment.CurrencyCode,
    //                         transactionID: transactionID,
    //                         status: "pending",
    //                         createdAt: Date.now()
    //                     });
    //                     console.log("deposit Insert", deposit);

    //                     return cb({
    //                         status: 'success',
    //                         result: paymentBaseUrl,
    //                         message: "Player's Payment Window Show..!!"
    //                     })

    //                 } else {
    //                     return cb({
    //                         status: 'fail',
    //                         result: null,
    //                         message: "Sorry Payment Process not proceed forward"
    //                     })
    //                 }
    //             }
    //         } else {
    //             return cb({
    //                 status: 'fail',
    //                 result: null,
    //                 message: 'No Player Found!',
    //                 statusCode: 400
    //             })
    //         }

    //     } catch (error) {
    //         console.log("Error caught in depositMoney", error);
    //         Sys.Log.info('Error in depositMoney : ' + error);
    //     }
    // },

    // Leaderboard: async function (socket, data) {
    //     try {

    //         let players = await Sys.Game.Common.Services.PlayerServices.getByData({}, null, { sort: { chips: -1 }, limit: 10 });
    //         let player = await Sys.Game.Common.Services.PlayerServices.getById(data.playerId);
    //         let playerRank = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ chips: { $gt: player.chips } });
    //         // totalgame played and won games
    //         let gamesPlayed = await Sys.Game.Common.Services.GameServices.getGameCount({ history: { $elemMatch: { playerId: data.playerId } } });
    //         let gameWon = await Sys.Game.Common.Services.GameServices.getGameCount({ winners: { $elemMatch: { playerId: data.playerId } } });
    //         let topPlayer = [];
    //         if (players) {
    //             let p = 1;
    //             players.forEach(function (pl) {
    //                 topPlayer.push({
    //                     player: pl.username,
    //                     position: p++,
    //                     //amount: (pl.chips).toFixed(2),
    //                     amount: parseFloat(pl.chips),
    //                 });
    //             })

    //             return {
    //                 status: 'success',
    //                 result: {
    //                     topPlayer: topPlayer,
    //                     rank: parseInt(playerRank + 1),
    //                     gamePlayed: gamesPlayed, //(playerChips.statistics.gamePlayed == undefined)? 0 :playerChips.statistics.gamePlayed,
    //                     won: gameWon, //playerChips.statistics.won,
    //                     lost: (gamesPlayed - gameWon), //playerChips.statistics.lost,
    //                 },
    //                 message: 'Player Data Found'
    //             }
    //         }
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: await translate({ key: "player_not_found", language: socket.languageData }), // 'Player Not Found',
    //             statusCode: 400
    //         }
    //     } catch (e) {
    //         Sys.Log.info('Error in getting Leaderboard : ' + e);
    //     }
    // },

    // playerPicUpdate: async function (socket, data) {
    //     try {
    //         console.log("PLAYER PROFILE PIC",)
    //         let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId });

    //         if (player) {
    //             await Sys.Game.Common.Services.PlayerServices.updatePlayerData({
    //                 _id: data.playerId
    //             }, {
    //                 profilePic: data.profilePic,
    //                 avatar: null
    //             });
    //             let query = {
    //                 status: { "$ne": "Closed" },
    //             };
    //             let allRooms = await Sys.Game.CashGame.Texas.Services.RoomServices.getByData(query);
    //             let getPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: data.playerId });
    //             allRooms.forEach(async function (rooms) {
    //                 if (Sys.Rooms[rooms.id] != undefined) {
    //                     Sys.Rooms[rooms.id].players.forEach(function (roomPlayer) {
    //                         if (roomPlayer.id == data.playerId) {
    //                             roomPlayer.profilePicUrl = null;
    //                             roomPlayer.avatar = data.profilePic;
    //                         }
    //                     });
    //                 }
    //             });

    //             return {
    //                 status: 'success',
    //                 message: "Profile Updated Successfully.",
    //                 statusCode: 200,
    //             }
    //         }
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: 'Player Not Found.',
    //             statusCode: 400
    //         }

    //     } catch (e) {
    //         Sys.Log.info('Error in playerPicUpdate : ' + e);
    //     }
    // },

    // adminHallDisplayLogin: async function (socket, data) {
    //     try {
    //         const { roomId } = data;
    
    //         const gameData = await Sys.Game.Game1.Services.GameServices.getSingleGameData(
    //             { _id: roomId },
    //             { withdrawNumberList: 1, winners: 1, multipleWinners: 1 }
    //         );
    
    //         if (!gameData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: 'Game Not Found!'
    //             };
    //         }
    
    //         const {
    //             withdrawNumberList = [],
    //             winners = [],
    //             multipleWinners = [],
    //         } = gameData;
    
    //         /* Join room */
    //         socket.join(roomId);
    
    //         /* Attach socket metadata */
    //         socket.myData = {
    //             gameType: 'game_1',
    //             gameName: 'Spillorama',
    //             isAdmin: true
    //         };
    
    //         /* Stats */
    //         const totalWithdrawCount = withdrawNumberList.length;
    
    //         const fullHouseWinners = winners.filter(w => w.isFullHouse).length;
    
    //         const patternsWon = winners.length
    //             ? new Set(winners.map(w => w.lineType)).size
    //             : 0;
    
    //         /* Winning list */
    //         const winningList = multipleWinners.length
    //             ? multipleWinners.map(winner => ({
    //                 id: winner.playerId,
    //                 displayName: winner.playerName,
    //                 winnerCount: new Set(winner.lineTypeArray).size,
    //                 prize: winner.finalWonAmount
    //             }))
    //             : winners.map(winner => ({
    //                 id: winner.playerId,
    //                 displayName: winner.playerName,
    //                 winnerCount: 1,
    //                 prize: 0
    //             }));
    
    //         const result = {
    //             gameStatus: 'Running', // or use `status` if needed
    //             totalWithdrawCount,
    //             fullHouseWinners,
    //             patternsWon,
    //             withdrawNumberList,
    //             winningList
    //         };
    
    //         /* Emit events */
    //         setTimeout(async () => {
    //             await Sys.Io
    //                 .of(Sys.Config.Namespace.Game1)
    //                 .to(roomId)
    //                 .emit('WithdrawBingoBall', {
    //                     number: 1,
    //                     color: 'White',
    //                     totalWithdrawCount: 1
    //                 });
    //         }, 5000);
    
    //         await Sys.Io
    //             .of(Sys.Config.Namespace.Game1)
    //             .to(roomId)
    //             .emit('GameFinish', {
    //                 winnerList: [{ name: "Spillorama" }]
    //             });
    
    //         return {
    //             status: 'success',
    //             message: 'Game Found!'
    //         };
    
    //     } catch (error) {
    //         Sys.Log.info('Error in adminHallDisplayLogin : ' + error);
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: 'Something went wrong',
    //             statusCode: 500
    //         };
    //     }
    // },

    // generateXmlOfWithdraw: async function () {
    //     try {
    //         let halls = await Sys.App.Services.HallServices.getByData({ status: "active", isDeleted: false }, { agents: 1, name: 1 });
    //         //console.log("halls---", halls);
    //         if (halls.length > 0) {
    //             let emails = [];
    //             let emailsData = await Sys.App.Services.WithdrawServices.getEmailsByData({}, { email: 1 }, {});
    //             if (emailsData.length > 0) {
    //                 for (let a = 0; a < emailsData.length; a++) {
    //                     emails.push(emailsData[a].email);
    //                 }
    //             }
    //             console.log("emails to send xml", emails);
    //             if (emails.length == 0) {
    //                 console.log("No Email id found for sending withdraw xml file.")
    //                 return;
    //             }
    //             for (let h = 0; h < halls.length; h++) {
    //                 // let agents = await Sys.App.Services.AgentServices.getByDataForRole({ hall: { $elemMatch: { id: halls[h]._id.toString() } } }, { email: 1, name: 1 });
    //                 // if (agents.length > 0) {
    //                 //     let emails = [];
    //                 //     for (let a = 0; a < agents.length; a++) {
    //                 //         emails.push(agents[a].email);
    //                 //     }
    //                 const timezone = 'Europe/Oslo';
    //                 const yesterdayDate = moment().tz(timezone).subtract(1, 'day').startOf('day').toDate();
    //                 const endOfYesterdayDate = moment().tz(timezone).subtract(1, 'day').endOf('day').toDate();
    //                 let query = {
    //                     status: "pending",
    //                     withdrawType: "Withdraw in Bank",
    //                     hallId: halls[h]._id.toString(),
    //                     createdAt: {
    //                         $gte: yesterdayDate,  // Greater than or equal to yesterday's start
    //                         $lte: endOfYesterdayDate // Less than or equal to yesterday's end
    //                     }
    //                 }
    //                 //console.log("query---", query);

    //                 let data = await Sys.App.Services.WithdrawServices.getWithdrawByData(query, { withdrawAmount: 1, name: 1, bankAccountNumber: 1, createdAt: 1, status: 1 }, { sort: { createdAt: -1 } });
    //                 const xmlFileName = `withdraw_${halls[h]._id.toString()}.xml`;
    //                 const fieldsToSelect = { 'createdAt': 'Date', 'name': 'Name', 'bankAccountNumber': 'AccountNumber', 'withdrawAmount': "Amount", 'status': 'Status' };
    //                 let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    //                 xmlContent += '<Documents>\n';
    //                 //console.log("data--", data.length, halls[h]._id.toString());

    //                 if (data.length > 0) {
    //                     for (let d = 0; d < data.length; d++) {
    //                         xmlContent += '  <Withdraw>\n';
    //                         for (const key in fieldsToSelect) {
    //                             if (fieldsToSelect.hasOwnProperty(key)) {
    //                                 let value = data[d][key];
    //                                 let keyValue = fieldsToSelect[key];
    //                                 if (keyValue == "Date") {
    //                                     xmlContent += `    <${keyValue}>${moment(value).format('MMMM Do YYYY, hh:mm')}</${keyValue}>\n`; // Dynamically access fields from the document
    //                                 } else {
    //                                     xmlContent += `    <${keyValue}>${value}</${keyValue}>\n`; // Dynamically access fields from the document
    //                                 }

    //                             }
    //                         }
    //                         xmlContent += '  </Withdraw>\n';
    //                     }
    //                 }

    //                 // data.forEach(doc => {
    //                 //     xmlContent += '  <Withdraw>\n';
    //                 //     for (const key in fieldsToSelect) {
    //                 //         if (fieldsToSelect.hasOwnProperty(key)) {
    //                 //             let value = doc[key];
    //                 //             let keyValue = fieldsToSelect[key];
    //                 //             xmlContent += `    <${keyValue}>${value}</${keyValue}>\n`; // Dynamically access fields from the document
    //                 //         }
    //                 //     }
    //                 //     xmlContent += '  </Withdraw>\n';
    //                 // });

    //                 xmlContent += '</Documents>';

    //                 // fs.writeFileSync(xmlFileName, xmlContent, { flag: 'w' });
    //                 // console.log(`XML file '${xmlFileName}' created successfully`);
    //                 // let info = {
    //                 //     from: Sys.Config.App.mailer.defaultFromAddress,
    //                 //     to: emails,
    //                 //     subject: 'Withdraw Transaction XML File',
    //                 //     text: 'Please find the XML file attached.',
    //                 //     attachments: [
    //                 //         {
    //                 //             filename: xmlFileName,
    //                 //             path: xmlFileName
    //                 //         }
    //                 //     ]
    //                 // };
    //                 // defaultTransport.sendMail(info, function (error) {
    //                 //     if (error) {
    //                 //         console.log('Error occurred:', error);
    //                 //     } else {
    //                 //         console.log('Email sent:', info.response);
    //                 //     }

    //                 //     fs.unlink(xmlFileName, (err) => {
    //                 //         if (err) throw err;
    //                 //         console.log('XML file deleted successfully', xmlFileName);
    //                 //     });

    //                 // });

    //                 fs.writeFile(xmlFileName, xmlContent, { flag: 'w' }, err => {
    //                     if (err) {
    //                         console.error('Error writing XML file:', err);
    //                     } else {
    //                         console.log(`XML file '${xmlFileName}' created successfully`);
    //                         let info = {
    //                             from: Sys.Config.App.mailer.defaultFromAddress,
    //                             to: emails,
    //                             subject: `Withdraw Transaction XML File of date ${moment().tz(timezone).subtract(1, 'day').format("DD-MM-YYYY")}`,
    //                             text: `Please find the XML file attached of hall Name "${halls[h].name}".`,
    //                             attachments: [
    //                                 {
    //                                     filename: xmlFileName,
    //                                     path: xmlFileName
    //                                 }
    //                             ]
    //                         };
    //                         defaultTransport.sendMail(info, function (error) {
    //                             if (error) {
    //                                 console.log('Error occurred:', error);
    //                             } else {
    //                                 console.log('Email sent:');
    //                             }

    //                             fs.unlink(xmlFileName, (err) => {
    //                                 if (err) throw err;
    //                                 console.log('XML file deleted successfully', xmlFileName);
    //                             });

    //                         });
    //                     }
    //                 });

    //                 // } else {
    //                 //     console.log("No agent found", agents);
    //                 // }
    //             }
    //         }


    //     } catch (e) {
    //         console.log("Error in creating data", e);
    //     }
    // },

    // addCustomerNumberInExistingPlayers: async function () {
    //     try {
    //         const players = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({}, { username: 1 }, {});
    //         // Iterate through customers and update customerIds sequentially
    //         let lastCustomerNumber = 0;
    //         for (let i = 0; i < players.length; i++) {
    //             let newCustomerNumber = lastCustomerNumber + 1;

    //             // Keep incrementing the customer ID until it's unique
    //             while (await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ customerNumber: newCustomerNumber }) > 0) {
    //                 console.log("this customer number is already present , try with new", newCustomerNumber);
    //                 newCustomerNumber++;
    //             }
    //             lastCustomerNumber = newCustomerNumber;
    //             await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: players[i]._id }, { customerNumber: newCustomerNumber });
    //         }
    //     } catch (e) {
    //         console.log("Error adding customer Number to existing players");
    //     }
    // },
    
}

async function createExcel(data, hall) {
    //const fieldsToSelect = { 'createdAt': 'Date', 'name': 'Full Name', 'bankAccountNumber': 'AccountNumber', 'withdrawAmount': "Amount" };
    const excelFileName = `withdraw_${hall}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Withdraw');

    // Define column headers
    worksheet.columns = [
        { header: 'Date', key: 'createdAt', width: 20 },
        { header: 'Full Name', key: 'name', width: 20 },
        { header: 'AccountNumber', key: 'bankAccountNumber', width: 20 },
        { header: 'Amount (Kr)', key: 'withdrawAmount', width: 20 },
        { header: 'Hall Name', key: 'hallName', width: 20 },
    ];
    worksheet.getRow(1).alignment = { horizontal: 'center' };
    // Add data to the sheet
    if (data.length > 0) {
        data.forEach(item => {
            worksheet.addRow({
                createdAt: moment(item.createdAt).format('DD-MM-YYYY, h:mm a'),
                name: item.name,
                bankAccountNumber: item.bankAccountNumber,
                withdrawAmount: item.withdrawAmount,
                hallName: item.hallName,
            }).eachCell((cell, colNumber) => {
                cell.alignment = { horizontal: 'center' };
            });
        });
    } else {
        const row = worksheet.addRow({});
        row.getCell('createdAt').value = 'No data available';
        row.getCell('createdAt').alignment = { horizontal: 'center' };
        row.getCell('createdAt').font = { italic: true };
        worksheet.mergeCells(`A${row.number}:D${row.number}`);
    }


    // Save the workbook
    await workbook.xlsx.writeFile(excelFileName);

    return excelFileName;

}
async function generateAuthToken(userId, expiresIn, secretKey) {
    //const secretKey = jwtcofig.secret;
    // Conditionally set the expiresIn value
    const tokenOptions = expiresIn ? { expiresIn } : {};
    const token = jwt.sign(
        { id: userId }, // Payload
        secretKey, // Secret Key
        tokenOptions  // Expiration options (will be empty if expiresIn is null)
    );
    return token;
}

async function handleImageUpdate(player, imageData, index, language) {
    if (imageData) {
        const id = await randomString(24);
        const pic = await picSave(id, imageData);

        if (pic instanceof Error) {
            throw new Error(await translate({ key: "file_invalid", language: language }));
        }

        const oldImagePath = player.profilePic && player.profilePic[index] 
            ? path.join(__dirname, "public", player.profilePic[index]) 
            : null;

        // Delete old image if it exists and it's different from the new one
        if (oldImagePath && fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
            console.log(`Old image at ${oldImagePath} deleted.`);
        }

        return pic;
    }
    return null;
}

// Helper function to render error responses
const renderErrorResponse = async (res, reponsePage, language, messageKey, titleKey, isDisplayGoBackBtn) => {
    const data = {
        status: "Failed",
        message: await translate({ key: messageKey, language }),
        title: await translate({ key: titleKey, language }),
        goBack: await translate({ key: "goBackbutton", language }),
        isDisplayGoBackBtn
    };
    return res.render(reponsePage, data);
};

// Helper function to render success responses
const renderSuccessResponse = async (res, reponsePage, language, messageKey, titleKey, isDisplayGoBackBtn) => {
    const data = {
        status: "Completed",
        message: await translate({ key: messageKey, language }),
        title: await translate({ key: titleKey, language }),
        goBack: await translate({ key: "goBackbutton", language }),
        isDisplayGoBackBtn
    };
    return res.render(reponsePage, data);
};

// Helper function to render pending responses
const renderPendingResponse = async (res, reponsePage, language, messageKey, titleKey, isDisplayGoBackBtn) => {
    const data = {
        status: "Pending",
        message: await translate({ key: messageKey, language }),
        title: await translate({ key: titleKey, language }),
        goBack: await translate({ key: "goBackbutton", language }),
        isDisplayGoBackBtn
    };
    return res.render(reponsePage, data);
};

