const Sys = require('../../../Boot/Sys');

module.exports = function (Socket) {
    try {
        // Listing of halls, used in register page
        Socket.on("HallList", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.GameController.hallList(Socket, data));
            } catch (error) {
                console.log("Error in HallList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Get Total Online Players, Connected to socket ] Need to check if used from front end or not
        Socket.on("GameOnlinePlayerCount", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.GameController.gameOnlinePlayerCount(Socket, data));
            } catch (error) {
                console.log("Error in GameOnlinePlayerCount:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Get Game Type List with images ]
        Socket.on("GameTypeList", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.GameController.getGameTypeList(Socket, data));
            } catch (error) {
                console.log("Error in GameTypeList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Game 1 Hall closed status
        Socket.on("IsHallClosed", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.GameController.isHallClosed(Socket, data));
            } catch (error) {
                console.log("Error in IsHallClosed:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Get Game 1 status for particular player
        Socket.on("Game1Status", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.GameController.game1Status(Socket, data));
            } catch (error) {
                console.log("Error in Game1Status:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Login Player
        Socket.on("LoginPlayer", async function (data, responce) {
            try {
                console.log("LoginPlayer called: ", data);
                const result = await Sys.Game.Common.Controllers.PlayerController.playerLogin(Socket, data);
                // BIN-134: Sett authToken tilgjengelig for lobby-JS
                if (result && result.status === 'success' && result.result && result.result.authToken) {
                    Socket.emit('_playerToken', { token: result.result.authToken });
                    // Broadcast til alle sockets — lobby auth-beacon plukker det opp
                    if (Sys.IO) {
                        Sys.IO.emit('_playerAuthenticated', {
                            playerId: result.result.playerId,
                            token: result.result.authToken
                        });
                    }
                }
                responce(result);
            } catch (error) {
                console.log("Error in LoginPlayer:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Get player details only to check if player is present and if then pass points and wallet details
        Socket.on("PlayerDetails", async function (data, responce) {
            try {
                const result = await Sys.Game.Common.Controllers.PlayerController.playerDetails(Socket, data);
                // BIN-134: Broadcast auth-signal ved session-restore (PlayerDetails = bruker allerede innlogget)
                if (result && result.status === 'success' && data.playerId && Sys.IO) {
                    try {
                        const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                            { _id: data.playerId }, { 'otherData.authToken': 1 }
                        );
                        if (player?.otherData?.authToken) {
                            Sys.IO.emit('_playerAuthenticated', {
                                playerId: data.playerId,
                                token: player.otherData.authToken
                            });
                        }
                    } catch (e) { console.warn('BIN-134: Could not emit auth on PlayerDetails:', e.message); }
                }
                responce(result);
            } catch (error) {
                console.log("Error in PlayerDetails:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Logout the player
        Socket.on("Logout", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerLogout(Socket, data));
            } catch (error) {
                console.log("Error in Logout:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // select lucky number for all game types in settings
        Socket.on("SetLuckyNumber", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.selectLuckyNumber(Socket, data));
            } catch (error) {
                console.log("Error in SetLuckyNumber:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // get lucky number in settings
        Socket.on("GetLuckyNumber", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.getLuckyNumber(Socket, data));
            } catch (error) {
                console.log("Error in GetLuckyNumber:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("AvailableGames", async function (data, responce) {
            try {
                console.log("AvailableGames Called............!!!!!!!!")
                responce(await Sys.Game.Common.Controllers.GameController.availableGameTypes(Socket, data));
            } catch (error) {
                console.log("Error in AvailableGames:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("ReconnectPlayer", async function (data, responce) {
            try {
                console.log("Reconnect Called............!!!!!!!!", data)
                const result = await Sys.Game.Common.Controllers.PlayerController.reconnectPlayer(Socket, data);
                // BIN-134: Broadcast auth-signal ved reconnect
                if (result && result.status === 'success' && data.playerId && Sys.IO) {
                    try {
                        const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
                            { _id: data.playerId }, { 'otherData.authToken': 1 }
                        );
                        if (player?.otherData?.authToken) {
                            Sys.IO.emit('_playerAuthenticated', {
                                playerId: data.playerId,
                                token: player.otherData.authToken
                            });
                        }
                    } catch (e) { console.warn('BIN-134: Could not emit auth on ReconnectPlayer:', e.message); }
                }
                responce(result);
            } catch (error) {
                console.log("Error in ReconnectPlayer:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("CheckRunningGame", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.checkRunningGame(Socket, data));
            } catch (error) {
                console.log("Error in CheckRunningGame:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("DeletePlayerAccount", async function (data, responce) {
            try {
                console.log("DeletePlayerAccount called: ", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.deletePlayerAccount(Socket, data));
            } catch (error) {
                console.log("Error in DeletePlayerAccount:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("SetLimit", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.setLimit(Socket, data));
            } catch (error) {
                console.log("Error in SetLimit:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on('PlayerNotifications', async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerNotifications(Socket, data));
            } catch (error) {
                console.log("Error in PlayerNotifications:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("TransactionHistory", async function (data, responce) {
            try {
                // console.log("TransactionHistory called: ", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.TransactionHistory(Socket, data));
            } catch (error) {
                console.log("Error in TransactionHistory:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        // Socket.on("RegisterPlayer", async function (data, responce) {
        //     // console.log("Register Player", data);
        //     responce(await Sys.Game.Common.Controllers.PlayerController.playerRegister(Socket, data));
        // });

        // [ Done ]
        Socket.on("UpdateFirebaseToken", async function (data, responce) {
            try {
                // console.log("UpdateFirebaseToken Player", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.updateFirebaseToken(Socket, data));
            } catch (error) {
                console.log("Error in UpdateFirebaseToken:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("playerForgotPassword", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerForgotPassword(Socket, data));
            } catch (error) {
                console.log("Error in playerForgotPassword:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("playerChangePassword", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerChangePassword(Socket, data));
            } catch (error) {
                console.log("Error in playerChangePassword:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("UpdateProfile", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.updateProfile(Socket, data));
            } catch (error) {
                console.log("Error in UpdateProfile:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("GameTypeData", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.gameTypeData(Socket, data));
            } catch (error) {
                console.log("Error in GameTypeData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("FAQ", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.faq(Socket, data));
            } catch (error) {
                console.log("Error in FAQ:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Terms", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.terms(Socket, data));
            } catch (error) {
                console.log("Error in Terms:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Support", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.support(Socket, data));
            } catch (error) {
                console.log("Error in Support:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Aboutus", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.aboutUs(Socket, data));
            } catch (error) {
                console.log("Error in Aboutus:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("ResponsibleGameing", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.responsibleGameing(Socket, data));
            } catch (error) {
                console.log("Error in ResponsibleGameing:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Links", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.links(Socket, data));
            } catch (error) {
                console.log("Error in Links:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("myWinnings", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.myWinnings(Socket, data));
            } catch (error) {
                console.log("Error in myWinnings:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("EnableNotification", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.EnableNotification(Socket, data));
            } catch (error) {
                console.log("Error in EnableNotification:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("VoucherList", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.VoucherList(Socket, data));
            } catch (error) {
                console.log("Error in VoucherList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("RedeemVoucher", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.RedeemVoucher(Socket, data));
            } catch (error) {
                console.log("Error in RedeemVoucher:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("BlockMySelf", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.BlockMySelf(Socket, data));
            } catch (error) {
                console.log("Error in BlockMySelf:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("DepositMoney", async function(data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.depositMoneyOfflineAndOnline(Socket, data));
            } catch (error) {
                console.log("Error in DepositMoney:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        // Socket.on("DepositMoney", async function (data, responce) {
        //     Sys.Game.Common.Controllers.PlayerController.depositMoney(Socket, data, (cb) => {
        //         return responce(cb);
        //     });
        // });

        Socket.on("playerProfilePic", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerPicUpdate(Socket, data));
            } catch (error) {
                console.log("Error in playerProfilePic:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("Playerprofile", async function (data, responce) {
            try {
                //console.log("Playerprofile  Called :",data);
                responce(await Sys.Game.Common.Controllers.PlayerController.playerProfile(Socket, data));
            } catch (error) {
                console.log("Error in Playerprofile:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("LoginWithUniqueId", async function (data, responce) {
            try {
                console.log("LoginWithUniqueId called: ", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.loginWithUniqueId(Socket, data));
            } catch (error) {
                console.log("Error in LoginWithUniqueId:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("GetApprovedHallList", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.getApprovedHallList(Socket, data));
            } catch (error) {
                console.log("Error in GetApprovedHallList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("PlayerUpdateInterval", async function (data, responce) {
            try {
                //console.log("==================playerUpdateInterval  Called :==================", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.playerUpdateInterval(Socket, data));
            } catch (error) {
                console.log("Error in PlayerUpdateInterval:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("VerifyPassword", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.verifyPassword(Socket, data));
            } catch (error) {
                console.log("Error in VerifyPassword:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("WithdrawMoney", async function (data, responce) {
            try {
                console.log("==================WithdrawMoney  Called :==================", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.playerWithdrawMoney(Socket, data));
            } catch (error) {
                console.log("Error in WithdrawMoney:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("updatePlayerLanguage", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.updatePlayerLanguage(Socket, data));
            } catch (error) {
                console.log("Error in updatePlayerLanguage:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("testingCallEvent", async function (data, responce) {
            try {
                console.log("==================testingCallEvent  Called :==================", data);
                responce(await Sys.Game.Common.Controllers.GameController.startGameCron(Socket, data));
            } catch (error) {
                console.log("Error in testingCallEvent:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });


        // Socket.on("ReconnectPlayer", async function(data, responce) {
        //     console.log("Reconnect Called............!!!!!!!!", data);
        //     responce(await Sys.Game.Common.Controllers.PlayerController.reconnectPlayer(Socket, data));
        // });

        /** Game Management **/

        // Socket.on("sendMulNotifications", async function(data, responce) {
        //     responce(await Sys.Game.Common.Controllers.GameController.sendMulNotifications(Socket, data));
        // });

        /* 
            Game 3 Socket Event
        */
        Socket.on("getGame3PurchaseData", async function (data, responce) {
            try {
                console.log("getGame3PurchaseData: ", data);
                responce(await Sys.Game.Common.Controllers.GameController.getGame3PurchaseData(Socket, data));
            } catch (error) {
                console.log("Error in getGame3PurchaseData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("game3TicketCheck", async function (data, responce) {
            try {
                console.log("game3TicketCheck: ", data);
                responce(await Sys.Game.Common.Controllers.GameController.game3TicketCheck(Socket, data));
            } catch (error) {
                console.log("Error in game3TicketCheck:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("game3TicketBuy", async function (data, responce) {
            try {
                console.log("game3TicketBuy: ", data);
                responce(await Sys.Game.Common.Controllers.GameController.game3TicketBuy(Socket, data));
            } catch (error) {
                console.log("Error in game3TicketBuy:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("game3TicketCheck32", async function (data, responce) {
            try {
                // console.log("Game2BuyTickets  Called :", data);
                responce(await Sys.Game.Common.Controllers.GameController.game3TicketCheck(Socket, data));
            } catch (error) {
                console.log("Error in game3TicketCheck32:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        /* Socket.on("playerStatistics",async function(data,responce) {
           console.log("playerStatistics  Called :",data);
           responce(await Sys.Game.Common.Controllers.PlayerController.playerStatistics(Socket,data));
         });*/


        Socket.on("Localaccess", async function (data, responce) {
            try {
                responce(await Game.ThreeCards.Controllers.PlayerController.localaccess(Socket, data));
            } catch (error) {
                console.log("Error in Localaccess:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Socket.on("sendMulNotifications", async function(data, responce) {
        //     responce(await Sys.Game.Common.Controllers.InAppPurchaseController.sendMulNotifications(Socket, data));
        // });

        // [ Which Reason Socket Will Disconneted (We Get in Reason) [ For More Information Please Visit (https://socket.io/docs/v3/client-socket-instance/)]]
        Socket.on("disconnect", async function (reason) {
            try {
                console.log("Socket Disconnected", reason);
                // Iterate through the object
                for (const key in Sys.ConnectedPlayers) {
                    if (Sys.ConnectedPlayers.hasOwnProperty(key)) {
                        if (Sys.ConnectedPlayers[key].socketId == Socket.id) {
                            console.log("Player Goes Offline here.");
                            Sys.ConnectedPlayers[key].status = "Offline";
                        }
                    }
                }
            } catch (error) {
                console.log("Error in disconnect handler:", error);
            }
        });

        Socket.on("createBotPlayers", async function (data, responce) {
            try {
                console.log("createBotPlayers called: ", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.createBotPlayers(Socket, data));
            } catch (error) {
                console.log("Error in createBotPlayers:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("ScreenSaver", async function (data, responce) {
            try {
                console.log("Screensaver called: ", data);
                responce(await Sys.Game.Common.Controllers.PlayerController.ScreenSaver(Socket, data));
            } catch (error) {
                console.log("Error in ScreenSaver:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });


        // Not required as it is now merged in myWinnings
        // Socket.on("lastHourLossProfit", async function (data, responce) {
        //     responce(await Sys.Game.Common.Controllers.PlayerController.lastHourLossProfit(Socket, data));
        // });

        Socket.on("CheckPlayerBreakTime", async function (data, responce) {
            try {
                //console.log("CheckPlayerBreakTime  Called :",data);
                responce(await Sys.Game.Common.Controllers.PlayerController.CheckPlayerBreakTime(Socket, data));
            } catch (error) {
                console.log("Error in CheckPlayerBreakTime:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });
        
        Socket.on("verifyByBankId", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.verifyByBankId(Socket, data));
            } catch (error) {
                console.log("Error in verifyByBankId:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("PlayerSettings", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.playerSettings(Socket, data));
            } catch (error) {
                console.log("Error in PlayerSettings:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("AddOrUpdateBlockRule", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.addOrUpdateBlockRule(Socket, data));
            } catch (error) {
                console.log("Error in AddOrUpdateBlockRule:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // RefreshAccessToken  
        Socket.on("RefreshAccessToken", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.refreshAccessToken(Socket, data));
            } catch (error) {
                console.log("Error in RefreshAccessToken:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Switch hall for web players
        Socket.on("SwitchHall", async function (data, responce) {
            try {
                responce(await Sys.Game.Common.Controllers.PlayerController.switchHall(Socket, data));
            } catch (error) {
                console.log("Error in SwitchHall:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Hall List with Limits
        Socket.on("PlayerHallLimit", async function (data, responce) {
            try {
                console.log("PlayerHallLimit called---", data)
                responce(await Sys.Game.Common.Controllers.PlayerController.playerHallLimit(Socket, data));
            } catch (error) {
                console.log("Error in PlayerHallLimit:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Player Sound and Voice Settings
        Socket.on("PlayerSoundAndVoiceSettings", async function (data, responce) {
            try {
                console.log("PlayerSoundAndVoiceSettings called---", data)
                responce(await Sys.Game.Common.Controllers.PlayerController.playerSoundAndVoiceSettings(Socket, data));
            } catch (error) {
                console.log("Error in PlayerSoundAndVoiceSettings:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Not used events

        // Socket.on("Home", async function (data, responce) {
        //     // console.log("Home called: ", data);
        //     responce(await Sys.Game.Common.Controllers.GameController.home(Socket, data));
        // });

        // Socket.on("HallList", async function(data, responce) {
        //     // console.log("Home called: ", data);
        //     responce(await Sys.Game.Common.Controllers.GameController.groupHallList(Socket, data));
        // });

        // Socket.on("GamePlanList", async function (data, responce) {
        //     console.log("GamePlanList called: ", data);
        //     responce(await Sys.Game.Common.Controllers.GameController.gameList(Socket, data));
        // });

        // Socket.on("Leaderboard", async function (data, responce) {
        //     console.log("Leaderboard called: ", data);
        //     responce(await Sys.Game.Common.Controllers.GameController.leaderboard(Socket, data));
        // });

    } catch (error) {
        console.log("Error In Common Socket Handler : ", error);
    }

}