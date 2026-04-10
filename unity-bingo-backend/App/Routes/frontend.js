'use strict';

var express = require('express'),
    router = express.Router()
var Sys = require('../../Boot/Sys');

router.get('/Payment', Sys.App.Controllers.Auth.payment);
router.get('/resetPassword/:token', Sys.App.Controllers.Auth.playerResetPassword);
router.post('/resetPassword/:token', Sys.App.Controllers.Auth.playerPostResetPassword);

router.get('/player/reset-password/:token', Sys.App.Controllers.Auth.resetImportedPlayerPassword);
router.post('/player/reset-password/:token', Sys.App.Controllers.Auth.postResetImportedPlayerPassword);
module.exports = router