var express = require('express'),
    router = express.Router();
var Sys = require('../../Boot/Sys');

// [ Load Your Custom Middlewares ]
router.get('/backend', Sys.App.Middlewares.Frontend.frontRequestCheck, function (req, res) {
    res.send('This is Backend');
});



/**
 * [ Auth Router ]
 */

router.get('/transactionsPaymet', Sys.App.Middlewares.Backend.loginCheck, Sys.App.Controllers.Auth.transactionsPaymet);
router.get('/admin', Sys.App.Middlewares.Backend.loginCheck, Sys.App.Controllers.Auth.login);
router.post('/admin', Sys.App.Middlewares.Backend.loginCheck, Sys.App.Middlewares.Validator.loginPostValidate, Sys.App.Controllers.Auth.postLogin);

router.get('/forgot-password', Sys.App.Controllers.Auth.forgotPassword);
router.post('/forgot-password', Sys.App.Controllers.Auth.forgotPasswordSendMail);
router.get('/reset-password/:token', Sys.App.Controllers.Auth.resetPassword);
router.post('/reset-password/:token', Sys.App.Controllers.Auth.postResetPassword);
router.get('/logout', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.Auth.logout);

router.get('/register', Sys.App.Middlewares.Backend.loginCheck, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.register);
router.get('/profile', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.profile);
router.post('/profile/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.profileUpdate);
router.post('/profile/changePwd', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.changePassword);
router.post('/profile/changeAvatar', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.changeAvatar);
router.post('/profile/changeSmsUsrPwd', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.changeSmsUsrPwd);
router.post('/profile/updateLanguage',Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.Auth.updateLanguage)

router.get('/agent/profile', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.Auth.agentProfile);
router.post('/profile/agent/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.Auth.agentProfileUpdate);
router.post('/profile/agent/changePwd', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.Auth.agentChangePassword);
router.post('/profile/agent/changeAvatar', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.Auth.agentChangeAvatar);
router.post('/profile/agent/updateLanguage',Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.Auth.agentUpdateLanguage)

/**
 * [ Dashboard Router ]
 */
router.get('/dashboard', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.home);
router.get('/dashboardChart/getMonthlyPlayedGameChart', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.getMonthlyPlayedGameChart);
router.get('/dashboardChart/getGameUsageChart', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.getGameUsageChart);
router.get('/dashboard/gameHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.gameHistory);
router.get('/dashboard/getTopPlayers/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.getTopPlayers);
router.get('/dashboard/ongoingGames/:gameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.Dashboard.ongoingGames);

// [ Agent Management ]

router.get('/agent', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.agent);
router.get('/agent/getAgent', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.getAgent);
router.get('/addAgent', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.addAgent);
router.post('/addAgent', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.addAgentPostData);
router.post('/agent/getAgentDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.AgentController.getAgentDelete);
router.get('/agentEdit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.editAgent);
router.post('/agentEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AgentController.editAgentPostData);

// [ Admin Management ]

router.get('/adminUser', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.admin);
router.get('/admin/getAdmin', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.getAdmin);
router.get('/addAdmin', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.addAdmin);
router.post('/addAdmin', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.addAdminPostData);
router.post('/admin/getAdminDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.AdminController.getAdminDelete);
router.get('/adminEdit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.editAdmin);
router.post('/adminEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.AdminController.editAdminPostData);
router.get('/editRole/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.AdminController.editRole);
router.post('/adminRoleUpdate/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.AdminController.updateRole);

/**
 * [Cash In/Out Routes]
 */

router.get('/agent/cashinout', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.CashInOutController.cashInOutPage);
router.get('/sold-tickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.CashInOutController.soldTickets);
router.get('/sold-tickets/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.CashInOutController.getSoldTickets);
// [ Loyalty Management ]

router.get('/loyalty', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.loyalty);
router.get('/loyalty/getLoyalty', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.getLoyalty);
router.get('/addLoyalty', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.addLoyalty);
router.post('/addLoyalty', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.addLoyaltyPostData);
router.post('/loyalty/getLoyaltyDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.LoyaltyController.loyaltyDelete);
router.get('/loyaltyEdit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.editLoyalty);
router.post('/loyaltyEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.editLoyaltyPostData);

router.get('/loyaltyManagement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.loyaltyManagement);
router.get('/loyalty/getPlayerLoyalty', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.getPlayerLoyalty);
router.get('/viewLoyaltyPlayer/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.LoyaltyController.viewLoyaltyPlayer);
// [ Pattern Management Router ]

router.post('/getPatternMenu', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.viewPatternMenu);
router.get('/patternGameDetailList/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.viewGamePatternList);
router.get('/getPatternDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.getPatternDetailList);
router.get('/addPattern/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.addPattern);
router.post('/addPattern/:typeId/:type/:slug', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.addPatternPostData);
router.get('/patternEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.editPattern);
router.post('/patternEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.editPatternPostData);
router.post('/getPatternDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.getPatternDelete);
router.get('/viewPattern/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.viewPatternDetails);
router.post('/checkForPatternName', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.patternController.checkForPatternName);
// [ Game Type Management ]

router.get('/gameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.gameType);
router.get('/gameType/getGameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGameType);
router.get('/addGameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addGameType);
router.post('/addGameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addGameTypePostData); // 
router.get('/editGameType/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editGameType);
router.post('/editGameType/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editGameTypePostData);
router.post('/gameType/deleteGameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.deleteGameType);
router.get('/viewGameType/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameType);

// [ Sub Game for game 1 ]
router.get('/subGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.subGame1);
router.get('/subGames/getSubGameList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.subGame1List);
router.get('/addSubGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.addSubGame);
router.post('/addSubGameData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.addSubGamePostData);
router.get('/subGameEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.editSubGame);
router.post('/subGameEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.editSubGamePostData);
router.post('/subGames/getSubGameDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.getSubGameDelete);
router.get('/viewSubGame/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.viewSubGame);
router.post('/checkForGameName', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.subGameController.checkForGameName);
// [ Other Modules ]

router.get('/background', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.background);
router.get('/otherModules/getBackground', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.getBackground);
router.get('/addBackground', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.addBackground);
router.post('/addBackground', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.addBackgroundPostData); // 
router.get('/editBackground/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.editBackground);
router.post('/editBackground/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.OtherController.editBackgroundPostData);
router.post('/background/deleteBackground', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.deleteBackground);
router.get('/viewBackground/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.viewBackground);

router.get('/theme', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.theme);
router.post('/themeEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.themeEdit);

//router.get('/miniGames', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.OtherController.miniGames);

// [ New Game Management(With DropDown) ] 

router.get('/gameManagement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viweGameManagement);
router.get('/gameManagementDetailList/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viweGameManagementDetail);
router.get('/getGameManagementDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGameManagementDetailList);
router.get('/addGameManagement/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addGameManagement);
router.post('/addGameManagement/:typeId/:type/:slug', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addGameManagementPostData); // 
router.post('/patternGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.patternGame); // 
router.get('/gameManagementEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editGameManagement);
router.post('/gameManagementEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), /* Sys.App.Middlewares.Validator.gameEditPostValidate,  */ Sys.App.Controllers.GameController.editGameManagementPostData); //
router.post('/getGameManagementDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGameManagementDelete);
router.get('/gameHistory/game1/:gameId/:grpId/:hallname', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.game1History);
router.get('/gameHistory/game2/:gameId/:grpId/:hallname', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.game2History);
router.get('/gameHistory/game3/:gameId/:grpId/:hallname', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.game3History);

//New Added
router.get('/viewGameDetails/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameDetails);
router.get('/viewGameTickets/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameTickets);
router.get('/getTicketTable/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getTicketTable);
router.get('/viewGameManagement/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameManagementDetails);
router.get('/viewsubGamesManagement/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewsubGamesManagement);
router.get('/viewsubGamesManagementDetails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewsubGamesManagementDetails);
router.get('/getGroupHallData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGroupHallData);
router.post('/repeatGame/:typeId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.repeatGame);
router.post('/stopGame/:typeId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.stopGame);


router.post('/startGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.startGame);
router.get('/viewGameHistory/:id/:gameName', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameHistory);
router.get('/viewPhysicalGameHistory/:id/:gameName', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewPhysicalGameHistory)
router.get('/viewTicket/:id/:ticketId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewTicket);

//router.get('/editTicket/:id/:gameId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editTicket);

//close Day Router
router.get('/closeDayGameManagement/:typeId/:id/:gameType', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.closeDayGameManagement); // 
router.post('/closeDayAdd', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.closeDayAdd); // 
router.get('/getCloseDayData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getCloseDayData); // 
router.post('/deleteCloseDay', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.deleteCloseDay); // 
router.post('/updateCloseDay', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.updateCloseDay); // 

// Auto Stop On/Off
router.post('/game/auto-stop', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.GameController.autoStopOnOff);

// [ Saved Game ]
router.get('/savedGameList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.savedGameList);
router.get('/savedGameDetailList/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.savedGameDetailList);
router.get('/getSavedGameDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getSavedGameDetailList);
router.post('/addSavedGameManagement/:typeId/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addSavedGameManagement); // 
router.get('/savedGameManagementEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editSaveGameManagement);
router.post('/savedGameManagementEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editSaveGameManagementPostData); //
router.get('/viewSaveGameManagement/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewSaveGameManagementDetails);
router.post('/getSaveGameDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getSaveGameManagementDelete);

// [ Report Games ]
router.get('/reportGame1', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame1);
router.get('/reportGame1/getReportGame1', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getReportGame1);
router.get('/reportGame1/game1Subgames/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame1SubGames);
router.get('/reportGame1/getGame1Subgames', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getGame1Subgames);

router.get('/reportGame2', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame2);
router.get('/reportGame2/getReportGame2', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getReportGame2);
router.get('/reportGame3', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame3);
router.get('/reportGame3/getReportGame3', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getReportGame3);
router.get('/reportGame4', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame4);
router.get('/reportGame4/getReportGame4', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getReportGame4);
router.get('/uniqueGameReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.uniqueIdReport);
router.get('/reportUnique/uniqueGameTicketReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.uniqueGameTicketReport);
router.get('/physicalTicketReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.physicalTicketReport);
router.get('/reportPhysical/physicalTicketReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.physicalGameTicketReport);
router.get('/hallSpecificReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.hallSpecificReportPage);
router.get('/getHallReports', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getHallSpecificReport);
router.get('/getHallOrderReports', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getHallSpecificOrderReport);

router.get('/reportGame5', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.reportGame5);
router.get('/reportGame5/getReportGame5', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getReportGame5);
router.get('/totalRevenueReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.totalRevenueReport);
router.get('/totalRevenueReport/getData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.ReportsController.getTotalRevenueReport);

// [ Payout for Players Games ]
router.get('/payoutPlayer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.viweGameManagementPayoutPlayer);
router.get('/PayoutGameManagementDetailListPlayer/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.PayoutGameManagementDetailListPlayer);
router.get('/payoutPlayerGetGameManagementDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.payoutPlayerGetGameManagementDetailList);
router.get('/viewPlayerPayout/:id/:gameId/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.viewPlayerPayout);

// [ Payout for Tickets Games ]
router.get('/payoutTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.viweGameManagementPayoutTickets);
router.get('/PayoutGameManagementDetailListTickets/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.PayoutGameManagementDetailListTickets);
router.get('/payoutTicketsGetGameManagementDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.payoutTicketsGetGameManagementDetailList);
router.get('/viewTicketPayout/:gameId/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.payoutController.viewTicketPayout);

// [ Risk Country ]
router.get('/riskCountry', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.riskCountryController.riskCountry);
router.get('/getRiskCountry', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.riskCountryController.getRiskCountry);
router.get('/getCountryList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.riskCountryController.getCountryList);
router.post('/addRiskCountry', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.riskCountryController.addRiskCountry);
router.post('/deleteRiskCountry', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.riskCountryController.deleteRiskCountry);

// [ Red Flag Category ]
router.get('/redFlagCategory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.redFlagCategory);
router.get('/getRedFlagCategory/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.getRedFlagCategory);
router.get('/getPlayersRedFlagList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.getPlayersRedFlagList);
router.get('/viewUserTransaction', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.viewUserTransaction);
router.get('/getUserTransactionHeader/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.getUserTransactionHeader);
router.get('/getUserTransactionList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.redFlagCategoryController.getUserTransactionList);

// [ Transactions player deposit ]
//router.get('/transactions', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.depositTransaction);
//router.get('/getTransactions', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getDepositTransaction);

router.get('/deposit/requests', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.depositRequsests);
router.get('/deposit/requests/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getDepositRequests);
router.post('/deposit/requests/accept', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.acceptDepositRequest);
router.post('/deposit/requests/reject', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.rejectDepositRequest);
router.get('/deposit/history', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.depositHistory);
router.get('/deposit/history/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getDepositHistory);
// [ Other Games ]
router.get('/wheelOfFortune', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.wheelOfFortune);
router.post('/editWheelOfFortune', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.editWheelOfFortune);

// [ Treasure Chest Route ]
router.get('/treasureChest', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.treasureChest);
router.post('/treasureChestEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.editTreasureChestPostData);

// [ Mystery Route ]
router.get('/mystery', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.mystery);
router.post('/mysteryEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.editMysteryPostData);

// [ User Routes ]
router.get('/user', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.UserController.users);
router.get('/user/getUser', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.UserController.getUser);
router.get('/addUser', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.UserController.addUser);
router.post('/addUser', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Middlewares.Validator.registerUserPostValidate, Sys.App.Controllers.UserController.addUserPostData);
router.post('/user/getUserDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.UserController.getUserDelete);
router.get('/userEdit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.UserController.editUser);
router.post('/userEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Middlewares.Validator.editUserPostValidate, Sys.App.Controllers.UserController.editUserPostData);

// [ CMS Routes ]

router.get('/cms', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.cmsView);

// [ FAQ Route ]
router.get('/faq', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.faqView);
router.get('/getFAQ', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.getFAQ);
router.get('/addFAQ', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.addFAQ);
router.post('/addFAQ', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.addFAQPostData);
router.get('/faqEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editFAQ);
router.post('/faqEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editFAQPostData);
router.post('/faq/getFAQDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.getFAQDelete);

// [ Terms of Service Route ]
router.get('/TermsofService', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.TermsofServiceView);
router.post('/termEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editTermPostData);
router.get('/terms-of-service', Sys.App.Controllers.cmsController.termsofService);
// [ Support Route ]
router.get('/Support', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.SupportView);
router.post('/supportEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editSupportPostData);

// [ Aboutus Route ]
router.get('/Aboutus', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.AboutusView);
router.post('/aboutusEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editAboutPostData);

// [ Responsible Gaming Route ]
router.get('/ResponsibleGameing', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.ResponsibleGameingView);
router.post('/resposibleGameingEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editResposibleGameingPostData);

// [ Links of Other Agencies Route ]
router.get('/LinksofOtherAgencies', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.LinksofOtherAgenciesView);
router.post('/linksOfOtherAgenciesEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.cmsController.editLinksofOtherAgenciesPostData);


// [ Hall Route ]

router.get('/hall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.hallView);
router.get('/hallAccountReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.hallAccountReportsView);
router.get('/hallAccountReportTable/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.hallAccountReportTableView);
router.get('/getHallAccountReport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.gethallAccountReportData);
router.get('/getHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.getHall);
router.get('/addHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.addHall);
router.post('/addHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.hallPostValidate, Sys.App.Controllers.hallController.addHallPostData); // 
router.get('/hallEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.editHall);
router.post('/hallEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.hallPostValidate, Sys.App.Controllers.hallController.editHallPostData);
router.post('/hall/getHallDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.getHallDelete);
router.post('/transferPlayersToHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.transferPlayersToHall);
router.get('/getHalls', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.getAllHalls);
router.post('/hall/report/saveData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.saveHallReportData);
router.post('/hall/set-cash-amount', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.hallController.setHallCashBalance);
router.post('/hall/check-hall-number', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.checkHallNumber);
router.post('/hall/check-ip-address', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.checkIpAddress);
// [ GroupHall Route ]

router.get('/groupHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.groupHallView);
router.get('/getGroupHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.getGroupHall);
router.get('/addGroupHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.addGroupHall);
router.post('/addGroupHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.addGroupHallPostData); // 
router.get('/groupHallEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.editGroupHall);
// router.post('/groupHallEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.groupHallPostValidate, Sys.App.Controllers.groupHallController.editGroupHallPostData);
router.post('/groupHallEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.editGroupHallPostData);
router.get('/groupHallView/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.groupHallDataView);
router.post('/groupHall/getGroupHallDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.getGroupHallDelete);
router.get('/removedGroup', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.removedGroup);
router.get('/getAvailableGroupHalls/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.getAvailableGroupHalls);
router.get('/getAllGroupHalls/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.groupHallController.getGroupHallData);
// [ Product Route ]
router.get('/productList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.productListPage);
router.get('/products/getProducts', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.getProducts);
router.get('/getProduct/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.getProduct);
router.post('/addProduct', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.addProductValidate, Sys.App.Controllers.productManagement.addProduct);
router.post('/editProduct', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.editProductValidate, Sys.App.Controllers.productManagement.editProduct);
router.post('/deleteProduct', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.deleteProduct);
router.get('/getCategories', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.getCategories);

// [ Category Route ]
router.get('/categoryList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.categoryListPage);
router.get('/categoryTable', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.categoryDataTable);
router.post('/addCategory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.addCategory);
router.post('/editCategory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.editCategory);
router.post('/deleteCategory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.deleteCategory);

// [ Hall-Product Route ]
router.get('/hallProductList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.hallProductListPage);
router.get('/getHallsandProducts', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.getHallsandProducts);
router.get('/getHallWithProduct/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.getHallWithProduct);
router.post('/addProductinHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.productManagement.updateProductinHall);

// [ Wallet Management Route ]

router.get('/wallet', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WalletController.walletView);
router.get('/getWallet', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WalletController.getWallet);
router.get('/viewWallet/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WalletController.viewUserWallet);

// [ Leaderboard Route ]

router.get('/leaderboard', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.leaderboardView);
router.get('/leaderboard/getLeaderboard', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.getLeaderboard);
router.get('/addLeaderboard', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.addLeaderboard);
router.post('/addLeaderboard', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.addLeaderboardPostData);
router.get('/leaderboardEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.editLeaderboard);
router.post('/leaderboardEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.editLeaderboardPostData);
router.post('/leaderboard/getLeaderboardDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.leaderboardController.getLeaderboardDelete);

// [ Voucher Route ]

router.get('/voucher', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.voucherView);
router.get('/voucher/getVoucher', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.getVoucher);
router.get('/addVoucher', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.addVoucher);
router.post('/addVoucher', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.addVoucherPostData);
router.get('/voucherEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.editVoucher);
router.post('/voucherEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.editVoucherPostData);
router.post('/voucher/getVoucherDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.getVoucherDelete);
router.get('/viewVoucher/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.VoucherController.viewVoucher);

// [ Withdraw Route ]

router.get('/withdrawAmt', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.withdrawAmt);
router.get('/withdrawAmount/getAllTXN', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.getAllTXN);
router.post('/withdrawAmount/chipsAction', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.chipsAction);
router.post('/withdrawAmount/getPlayerDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.getDelete);
router.get('/withdrawAmtHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.withdrawAmtHistory);
router.get('/withdrawAmtHistory/getAllTXNHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'master', 'agent', 'childAgent'), Sys.App.Controllers.WithdrawController.getAllTXNHistory);



router.get('/withdraw/requests/hall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.withdrawRequestInHall);
router.get('/withdraw/requests/bank', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.withdrawRequestInBank);
router.get('/withdraw/requests/hall/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.getWithdrawRequest);
router.post('/withdraw/requests/accept', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.acceptWithdrawRequest);
router.post('/withdraw/requests/reject', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.rejectWithdrawRequest);

router.get('/withdraw/history/hall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.withdrawHistoryHall);
router.get('/withdraw/history/hall/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.getWithdrawHistoryHall);
router.get('/withdraw/history/bank', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.withdrawHistoryBank);
router.get('/withdraw/history/bank/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.WithdrawController.getWithdrawHistoryBank);

router.get('/withdraw/list/emails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.withdrawEmails);
router.get('/withdraw/add/emails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.addWithdrawEmails);
router.post('/withdraw/add/emails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.addWithdrawEmailsPost);
router.get('/withdraw/get/emails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.getwithdrawEmails);
router.get('/withdraw/edit/emails/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.editWithdrawEmails);
router.post('/withdraw/edit/emails/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.editWithdrawEmailsPost);
router.post('/withdraw/delete/emails/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.deleteWithdrawEmails);
router.post('/withdraw/email/checkUnique/:emailId?', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.WithdrawController.checkForUniqueEmailId);
// [ Role Management Route ]

router.get('/role', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.view);
router.get('/role/getRole', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.getRole);
router.get('/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.add);
router.post('/saveRole', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.save);
router.get('/edit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.edit);
router.post('/updateRole/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.update);
router.get('/delete/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.delete);

// [ Player Route ]

router.get('/player', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.player);
router.get('/player/getPlayer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getPlayer);
router.get('/viewPlayer/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.viewPlayerDetails);
router.get('/playerEdit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.editPlayer);
router.post('/playerEdit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.editPlayerPostData); //Sys.App.Middlewares.Validator.editPlayerPostValidate
router.post('/changePwd/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.changePwd);
router.post('/player/hallStatus', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.hallStatus);
router.post('/player/getPlayerDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getPlayerDelete);
router.post('/player/playerSoftDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.playerSoftDelete);
router.post('/player/active', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.active);
router.get('/playerGameManagementDetailList/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.viwePlayerGameManagementDetail);
router.get('/playerGetGameManagementDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.playerGetGameManagementDetailList);
router.get('/playerTransactions/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.playerTransactions);
router.get('/getPlayerTransactions', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getPlayerTransactions);
router.get('/playerGameHistory/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.playerGameHistory);
router.get('/getPlayerGameHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getPlayerGameHistory);
router.post('/player/block-rules/delete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.deleteBlockRule);

router.get('/pendingRequests', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.pendingRequests);
router.get('/pendingRequests/getPendingPlayer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getPendingPlayer);
router.get('/pendingRequests/viewPendingPlayer/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.viewPendingRequestDetails);
router.post('/pendingRequests/approvePendingPlayer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.approvePendingRequest);
router.post('/pendingRequests/rejectPendingPlayer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.rejectPendingRequest);
router.post('/pendingRequests/forwardRequest', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.forwardToAdmin);


router.get('/rejectedRequests', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.rejectedRequests);
router.get('/player/getRejected', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getRejectedPlayer);
router.get('/viewRejectedPlayer/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.viewRejectedPlayerDetails);
router.post('/player/deleteRejected', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.deleteRejected);
router.post('/player/approveRejected', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.approveRejected);
router.get('/player/getGroupHalls', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getGroupHalls);
router.get('/player/getHalls', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getHalls);
router.get('/player/getAgents', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.getAgents);
router.post('/player/import', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.importPlayers);
router.post('/player/import/confirm', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.confirmImportPlayers);
// [ Settings Route ]

router.post('/settings/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.settingsAdd); // Sys.App.Middlewares.Validator.settingsValidation
router.get('/settings', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.settings);
router.post('/settings/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.settingsUpdate); // Sys.App.Middlewares.Validator.settingsValidation
router.get('/maintenance', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.maintenance);
router.get('/maintenance/edit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.editMaintenance);
router.post('/maintenance/edit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.updateMaintenance);
router.post('/maintenance/restartServer', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.restartServer);

router.post("/settings/addScreenSaverData",Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.addScreenSaverData); // Sys.App.Middlewares.Validator.settingsValidation)

router.get('/system/systemInformation', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.SettingsController.systemInformation);

router.post('/system/editSystemInformation', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SettingsController.editSystemInformation);

// [ Maintenance and Daily Reports Route ]
router.post('/maintenance/DailyReports', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.SettingsController.DailyReports);
router.post('/maintenance/DailyReportsWithMaintenance', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.SettingsController.DailyReportsWithMaintanace);

// [ Blocked IP List ]

router.get('/blockedIp', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.blockedIp);
router.get('/blockedIp/getBlockedIp', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.getBlockedIp);
router.get('/blockedIp/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.addblockedIp);
router.post('/blockedIp/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.addblockedIpPostData);
router.post('/blockedIp/delete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.deleteBlockedIp);
router.get('/blockedIp/edit/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.editBlockedIp);
router.post('/blockedIp/edit/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.SecurityController.editBlockedIpPostData);


router.get('/csvImport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.Helper.bingo.csvImport);
//router.get('/physical/csvImport', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.Game.Game1.Controllers.GameController.csvImport);
router.post('/player/reverify-bankid', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.reverifyBankid);

// Physical ticket management
router.get('/physicalTicketManagement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.physicalTicketManagement)
router.get('/physical/ticketList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.getPhysicalTicketList)


// [ Game Management(Without Dropdown As Per Old Wireframe) ]

// router.post('/gameMenu/getGameMenu', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viweGameMenu);
// router.get('/gameDetailList/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viweGameDetail);
// router.get('/getGameDetailList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGameDetailList);
// router.get('/addGame/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.addGame);
// router.post('/addGame/:typeId/:type/:slug', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.gameEditPostValidate, Sys.App.Controllers.GameController.addGamePostData);
// router.get('/gameEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.editGame);
// router.post('/gameEdit/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.gameEditPostValidate, Sys.App.Controllers.GameController.editGamePostData);
// router.post('/getGameDelete', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.getGameDelete);
// router.get('/viewGame/:typeId/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.GameController.viewGameDetails);


//Agent Role 
// router.get('/agentRole', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.agentRole);
// router.post('/role/getAgentRole', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.getAgentRole);
// router.get('/role/agentRoleAdd', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.agentRoleAdd);
// router.post('/role/saveAgentRole', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.saveAgentRole);
// router.get('/role/editAgentRole/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.editAgentRole);
// router.post('/role/updateAgentRole/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.updateAgentRole);
// router.get('/agentRole/delete/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.rollController.agentRoleDelete);

// Client APIS
router.get('/player/transactions/:id', Sys.App.Controllers.PlayerController.playerTransactionsClient);
router.get('/player/depositMoney', Sys.App.Controllers.PlayerController.depositMoneyClient);

/**
 *  popup modal
 */
router.post('/popup_modal', Sys.App.Controllers.Dashboard.allModal);
router.post('/generateTicket', Sys.App.Controllers.UniqueIdController.generateTicket);

/**
 * Edit Physical tickets route
 */
router.post('/generateEditTicket', Sys.App.Controllers.UniqueIdController.generateEditTicket);


/**
 * @ unique id route start
 */

router.get('/uniqueId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.uniqueId);
router.post('/addUniqueId', Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Middlewares.Validator.uniqueIdPostValidate, Sys.App.Controllers.UniqueIdController.addUniqueId);

router.get('/uniqueIdList', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.uniqueIdList);
router.get('/unique/getUniqueId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.getUniqueList);

router.get('/viewUniqueDetails/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.viewUniqueDetails);
router.get('/unique/viewSpaceficTicketDetails', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.viewSpaceficTicketDetails);

router.post('/unique/depositWithdraw', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.depositWithdraw);

router.post('/checkUniqueId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.checkUniqueId);
router.post('/unique/withdrawAccess', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Controllers.UniqueIdController.withdrawAccess);

router.post('/validateGameView', Sys.App.Controllers.Auth.validateGameView);

router.get('/unique/transactions/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.transactions);
router.get('/unique/get/transactions/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.UniqueIdController.getTransactions);


/**
 * [ Schedule Management Routes ]
 */

router.get('/schedules', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.schedules);
router.get('/getSchedules', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getSchedules);

router.get('/createSchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createSchedule);
router.post('/createSchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createSchedulePostData);
router.get('/editSchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editSchedule);
router.post('/editSchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editSchedulePostData);
router.post('/deleteSchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.deleteSchedule);

router.get('/viewSchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewSchedule);
router.post('/api/saveSubGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.saveSubGame);
router.get('/schedules/getStoredSubGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getStoredSubGame);
router.get('/schedules/getStoredSubGameData', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getStoredSubGameData);
router.get('/schedules/getStoredSubGames', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getStoredSubGames);
router.post('/api/saveSubGames', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.saveSubGames);
router.get('/schedules/checkStoreSubGameName', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.checkStoreSubGameName);

router.get('/createDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createDailySchedule);
router.post('/createDailySchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createDailySchedulePostData); // 
router.get('/schedule/getAvailableGroupHalls/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getAvailableGroupHalls);
router.get('/editDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editDailySchedule);
router.post('/editDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editDailySchedulePostData);
router.get('/viewDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewDailySchedule);
router.post('/deleteDailySchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.deleteDailySchedule);
router.post('/saveDailySchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.saveDailySchedulePostData);
router.get('/schedule/getHalls', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getScheduleHalls);
//Specail Game route
router.get('/createSpecialSchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createSpecailSchedule);
router.post('/createDailySpecialSchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.createDailySpecialSchedulePostData); // 
router.post('/schedule/getMasterHallData',Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getMasterHallData)

router.get('/viewSavedDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewSavedDailySchedule);
router.get('/editSavedDailySchedule/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editSavedDailySchedule);
router.post('/deleteSavedDailySchedule', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.deleteSavedDailySchedule);

router.get('/viewDailySchduleDetails/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewDailySchduleDetails);
router.get('/getCurrentSubgames/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getCurrentSubgames);

router.get('/edit-subgame/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editSubgame);
router.post('/edit-subgame/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.editSubgamePostData);

router.get('/view-subgame/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewSubgame);
router.get('/getGameAgents', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getGameAgents);
router.post('/agentReady', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.agentReady);
router.post('/startManualGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.startManualGame);
router.post('/stopGame1', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.stopGame1);
router.get('/viewGameHistory/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewGameHistory);
router.get('/viewPhysicalGameHistory/:id/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.viewPhysicalGameHistory);
router.post('/addManualWinning/', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.addWinningManual);
router.post('/player/register', Sys.Game.Common.Controllers.PlayerController.registerPlayer);

router.get('/schedule/getAvailableGroupHallsBasedSlots/:type', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getAvailableGroupHallsBasedSlots);
router.get('/schedule/getSchedulesBySlot', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.scheduleController.getSchedulesBySlot);

// add Physical Tickets Routes
router.get('/addPhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.addPhysicalTickets);
router.post('/addPhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.addPhysicalTicketsPost);
router.get('/getPhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.getPhysicalTickets);
router.post('/deletePhysicalTicket', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.deletePhysicalTicket);
router.get('/getLastRegisteredId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.getLastRegisteredId);
router.get('/getEditRegisteredId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.getEditRegisteredId);
router.post('/editPhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.editPhysicalTicketsPost);

router.post('/addGamePhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.addGamePhysicalTicketsPost);
router.get('/getSellPhysicalTickets/:gameId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.getSellPhysicalTickets);
router.post('/deleteSellPhysicalTicket', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.deleteSellPhysicalTicket);
router.post('/deleteAllSellPhysicalTicket', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.deleteAllSellPhysicalTicket);
router.get('/hall/getAgent', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.getHallAgents);
router.post('/purchasePhysicalTickets', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.purchasePhysicalTickets);

// [ Color Draft Route ]
router.get('/colorDraft', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.colorDraft);
router.post('/colorDraftEdit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.otherGameController.editColordraftPostData);

// Verifone payment Route, disable as we are not using verifone anymore
// router.get('/payment/iframe/:checkoutId', Sys.Game.Common.Controllers.PlayerController.verifoneIframe);
// router.get('/payment/deposit/response', Sys.Game.Common.Controllers.PlayerController.verifonePaymentResponse);
// router.post('/payment/webhook', Sys.Game.Common.Controllers.PlayerController.notification);
// router.post('/payment/goback', Sys.Game.Common.Controllers.PlayerController.goBacktoAppFromVerifone);

// Swedbankpay payment Route
router.get('/payment/iframe/:checkoutId', Sys.Game.Common.Controllers.PlayerController.swedbankpayIframe);
router.get('/payment/deposit/response', Sys.Game.Common.Controllers.PlayerController.swedbankpayPaymentResponse);
router.post('/payment/webhook', Sys.Game.Common.Controllers.PlayerController.swedbankpayNotification);
router.post('/payment/goback', Sys.Game.Common.Controllers.PlayerController.goBacktoAppFromSwedbankpay);

// Agent Dashboard cash in/ out routes
router.post('/agent/dailybalance/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.addDailyBalance);
router.get('/agent/dailybalance/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.getDailyBalance);
router.get('/agent/register-user/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.registerUserAddBalanceView);
router.get('/agent/register-user/withdraw', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.registerUserWithdrawBalanceView);
router.post('/agent/player/check-validity', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.checkForValidAgentPlayer);
router.get('/agent/register-user/balance/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.getRegisterUserBalance);
router.post('/agent/register-user/balance/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.updateRegisterUserBalance);
router.post('/agent/player/check-validity-balance', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.checkForValidAgentBalancePlayer);
router.post('/agent/control-daily-balance', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.controlDailyBalance);
router.post('/agent/settlement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.settlement);
router.get('/agent/settlement/get-date', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.getSettlementDate);

router.get('/agent/unique-id/add', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.uniqueIdAddBalanceView);
router.get('/agent/unique-id/withdraw', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.uniqueIdWithdrawBalanceView);
router.post('/agent/unique-id/check-validity', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.checkForValidUniqueId);
router.get('/agent/unique-id/balance/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.getUniqueIdBalance);
router.post('/agent/unique-id/balance/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.updateUniqueIdBalance);

router.get('/agent/game/status/pause', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameStatusForPause);
router.get('/agent/game/get-my-group-halls', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.getAgentsGroupHalls);
router.post('/agent/game/stop', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameStop);
router.get('/agent/game/status/start', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameStatusForStart);
router.post('/agent/game/start', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameStart);
router.get('/agent/cashout/view', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.viewCashoutDetails);
router.get('/agent/cashout/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.getPhysicalCashoutDetails);
router.post('/agent/wof/reward', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.wofGameReward);
router.post('/agent/game/stop-option', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameStopOption);

router.get('/agent/sellProduct', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.productCartPage);
router.post('/agent/createCart', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.createCart);
router.get('/agent/productCheckout', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.productCheckoutPage);
router.post('/agent/placeOrder', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.placeOrder);
router.post('/agent/cancelOrder', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.cancelOrder);
router.get('/agent/physicalCashOut', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.physicalCashOutPage);
router.get('/agent/getGamesInHall', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.getGamesInHall);
router.get('/agent/viewWonTickets/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.viewWonPhysicalTicketPage);
router.get('/agent/getPhysicalWinningInGame', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.getPhysicalWinningInGame);
router.post('/agent/reward-all', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.rewardAll);
router.post('/agent/sellProduct', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.sellProductAgent);

//order history
router.get('/orderHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.orderHistoryView);
router.get('/getOrderHistory', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.getOrderHistoryData);
router.get('/viewOrder/:cartId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.orderDetailsPage);

router.post('/agent/game/check-bingo', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentGameCheckBingo);
router.post('/agent/game/physical/cash-out', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentphysicalTicketCashout);
router.post('/agent/game/physical/add-to-wallet', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('agent'), Sys.App.Controllers.agentcashinoutController.agentphysicalTicketAddToWallet);

router.get('/agent/game/completed', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.getAgentCompletedGames);

router.get('/agent/physical/sell/:gameId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.sellagentTicketView);
//router.post('/agent/physical/sell', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.physicalTicketsController.addPhysicalTicketsPost);
router.get('/agent/game/hall-status', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.getGameHallStatus);
router.post('/agent/game/update-hall-status', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.updateGameHallStatus);
router.post('/updatePlayerLanguageIfnotexist', Sys.Game.Common.Controllers.PlayerController.updatePlayerLanguageIfnotexist);

router.get('/agent/upcoming-game/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.getUpcomingGames);
router.post('/agent/upcoming-game/stop', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.stopUpcomingGame);
router.post('/agent/upcoming-game/resume', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.resumeUpcomingGame);
router.get('/agent/upcoming-game/check-resume-eligibility', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.agentcashinoutController.checkResumeAligibility);

router.get('/report/settlement/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.individualSettlementView);
router.get('/report/settlement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.hallController.getIndividualSettlement);
router.post('/agent/settlement/edit', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin','agent'), Sys.App.Controllers.agentcashinoutController.editSettlement);

//Sys.App.Controllers.groupHallController.insertTvIdForExistingGoh();
router.get('/tv/:id',Sys.App.Controllers.scheduleController.redirectToTVScreen);

// Metronia API
//router.post('/agent/metronia/check-connect', Sys.App.Controllers.machineApiController.checkConnectMetronia);
//router.post('/agent/metronia/create-ticket', Sys.App.Controllers.machineApiController.createTicketMetronia);
//router.post('/agent/metronia/get-balance', Sys.App.Controllers.machineApiController.getBalanceMetronia);
//router.post('/agent/metronia/add-balance', Sys.App.Controllers.machineApiController.addBalanceMetronia);
//router.post('/agent/metronia/close-ticket', Sys.App.Controllers.machineApiController.closeTicketMetronia);
//router.post('/agent/metronia/close-all-tickets', Sys.App.Controllers.machineApiController.closeAllTicketMetronia);

router.post('/agent/create-ticket', Sys.App.Controllers.machineApiController.createTicketOfMachines);
router.post('/agent/add-balance', Sys.App.Controllers.machineApiController.addBalanceToMachineTickets);
router.post('/agent/get-balance', Sys.App.Controllers.machineApiController.getBalanceOfMachineTickets);
router.post('/agent/close-ticket', Sys.App.Controllers.machineApiController.closeTicketOfMachine);
router.post('/agent/close-all-tickets', Sys.App.Controllers.machineApiController.closeAllTicketOfMachine);
//router.post('/agent/okbingo/close-all-tickets', Sys.App.Controllers.machineApiController.closeAllTicketOfOKBingo);
router.post('/agent/get-numbers-today', Sys.App.Controllers.machineApiController.getNumbersOfToday);
router.post('/agent/okbingo/open-day', Sys.App.Controllers.machineApiController.openDayOkBingo);
// idkollen bankid verification
router.get('/player/bankid/redirect', Sys.Game.Common.Controllers.PlayerController.verifyPlayerBankId);
router.get('/player/bankId/iframe/:id', Sys.Game.Common.Controllers.PlayerController.bankIdIframe);
router.post('/player/bankid/goback', Sys.Game.Common.Controllers.PlayerController.goBacktoAppFromBankId);
// Image upload api for player
router.post('/player/profile/image/update', Sys.App.Middlewares.Backend.authenticatePlayerGameToken, Sys.Game.Common.Controllers.PlayerController.updateProfileImages);
// to verify or unverify manually from agent or admin
router.post('/player/verify/update', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.PlayerController.verifyPlayer);
// call this to update already approved player flag once once
router.post('/player/approved/update-flag', Sys.App.Controllers.PlayerController.updateIfPlayerAlreadyApproved);

// Track player spending
router.get('/players/track-spending', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.trackSpendingView);
router.get('/players/track-spending/get', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.getTrackSpendingData); 
router.get('/players/track-spending/transactions/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.trackSpendingTxView);
router.get('/players/track-spending/transactions/get/:id', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.PlayerController.getTrackSpendingTxData); 

// Purchase game 1 tickets
router.post('/game1/purchaseTickets', Sys.Game.Game1.Controllers.GameController.purchaseTickets);

// SMS Advertisement
router.get('/sms-advertisement', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.advertisementController.view);
router.get('/sms-advertisement/search-players', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.advertisementController.searchPlayers);
router.post('/sms-advertisement/send-sms-notification', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin'), Sys.App.Controllers.advertisementController.sendSmsNotification);

// Notifications
router.get('/notifications/count/hall/:hallId', Sys.App.Middlewares.Backend.Authenticate, Sys.App.Middlewares.Backend.HasRole('admin', 'agent'), Sys.App.Controllers.transactionController.getNotificationsCount);
router.get('/webview', function(req, res){res.send('')}); // for webview test for unity
module.exports = router