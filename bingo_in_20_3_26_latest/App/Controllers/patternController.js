const { FONT_SANS_10_BLACK } = require('jimp');
const { ConsoleTransportOptions } = require('winston/lib/winston/transports');
var Sys = require('../../Boot/Sys');
module.exports = {

    viewPatternMenu: async function (req, res) {
        try {

            let query = { pattern: true };
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType(query);

            var gameData = [];
            var dataGame = {};

            for (var i = 0; i < gameType.length; i++) {
                if (gameType[i].name != "Game1") {
                    dataGame = {
                        _id: gameType[i]._id,
                        name: gameType[i].name,
                    }
                    gameData.push(dataGame);
                }
            }

            return res.send({
                status: 'success',
                data: gameData,
                PatternMenu: 'active',
                DataOfGames: gameData
            });
        } catch (error) {
            Sys.Log.error('Error in viwePattern: ', error);
            return new Error(error);
        }
    },

    viewGamePatternList: async function (req, res) {
        try {
            //console.log("viewGamePatternList", req.params);
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Pattern Management'] || [];
                let stringReplace =req.session.details.isPermission['Pattern Management'] || [];
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
                if (stringReplace?.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
            }
            let gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            //console.log("gameType", gameType);
            let pattern = await Sys.App.Services.patternServices.getCount({ gameType: gameType.type, $or: [{ isFixedPtrn: { $exists: false } }, { isFixedPtrn: false }] });

            const keys = [
                "pattern_management",
                "add_pattern",
                "game_name",
                "pattern_number",
                "pattern_name",
                "creation_date_time",
                "action",
                "status",
                "search_pattern_name",
                "view_pattern",
                "show",
                "entries",
                "previous",
                "next",
                "submit"
            ];

            let patterns = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var theadField;
            let count = 0;
            if (gameType.type == "game_1") {
                theadField = [
                    patterns.game_name,
                    patterns.pattern_number,
                    patterns.pattern_name,
                    patterns.status,
                    patterns.creation_date_time,
                    patterns.action,
                ]
                count = pattern;
            } else if (gameType.type == "game_3") {
                theadField = [
                    patterns.game_name,
                    patterns.pattern_number,
                    patterns.pattern_name,
                    patterns.creation_date_time,
                    patterns.action,
                ]
                count = pattern;
            } else if (gameType.type == "game_4") {
                theadField = [
                    patterns.game_name,
                    patterns.pattern_number,
                    patterns.pattern_name,
                    patterns.creation_date_time,
                    patterns.action,
                ]
                count = pattern;
            } else if (gameType.type == "game_5") {
                theadField = [
                    patterns.game_name,
                    patterns.pattern_number,
                    patterns.pattern_name,
                    patterns.creation_date_time,
                    patterns.action,
                ]
                count = pattern;
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }
            


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PatternMenu: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                deleteFlag:deleteFlag,
                gameData: gameType,
                theadField: theadField,
                count: count,
                pattern: patterns,
                navigation: patterns
            };
            return res.render('patternManagement/pattern', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPatternDetailList: async function (req, res) {
        try {
            // console.log("getPatternDetailList calling", req.query);
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            if (req.query.gameType == "game_5") {
                sort = {};
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = { gameType: req.query.gameType, $or: [{ isFixedPtrn: { $exists: false } }, { isFixedPtrn: false }] };
            if (search != '') {
                query = { patternName: { $regex: '.*' + search + '.*', $options: 'i' }, gameType: req.query.gameType, $or: [{ isFixedPtrn: { $exists: false } }, { isFixedPtrn: false }] };
            }

            let reqCount = await Sys.App.Services.patternServices.getSelectedGamePatternCount(query);

            let data = await Sys.App.Services.patternServices.getGamePatternDatatable(query, length, start, sort);

            var gameData = [];
            var dataGame = {};

            if (req.query.gameType == "game_1") {
                for (var i = 0; i < data.length; i++) {
                    dataGame = {
                        gameName: data[i].gameName,
                        _id: data[i]._id,
                        patternNumber: data[i].patternNumber,
                        patternName: data[i].patternName,
                        status: data[i].status,
                        createdAt: data[i].createdAt,
                    }
                    gameData.push(dataGame);
                }
            } else if (req.query.gameType == "game_3") {
                for (var i = 0; i < data.length; i++) {
                    dataGame = {
                        gameName: data[i].gameName,
                        _id: data[i]._id,
                        patternNumber: data[i].patternNumber,
                        patternName: data[i].patternName,
                        patternType: data[i].patternType,
                        // patternPlace: data[i].patternPlace,
                        createdAt: data[i].createdAt,
                    }
                    gameData.push(dataGame);
                }
            } else if (req.query.gameType == "game_4") {
                for (var i = 0; i < data.length; i++) {
                    dataGame = {
                        gameName: data[i].gameName,
                        _id: data[i]._id,
                        patternNumber: data[i].patternNumber,
                        patternName: data[i].patternName,
                        patternType: data[i].patternType,
                        createdAt: data[i].createdAt,
                        // patternPrice: data[i].patternPrice
                    }
                    gameData.push(dataGame);
                }
            } else if (req.query.gameType == "game_5") {
                for (var i = 0; i < data.length; i++) {
                    dataGame = {
                        gameName: data[i].gameName,
                        _id: data[i]._id,
                        patternNumber: data[i].patternNumber,
                        patternName: data[i].patternName,
                        patternType: data[i].patternType,
                        createdAt: data[i].createdAt,
                        // patternPrice: data[i].patternPrice
                    }
                    gameData.push(dataGame);
                }
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            //console.log("data:::::::::::::", data)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getPatternDetailList: ', error);
            return new Error(error);
        }
    },


    addPattern: async function (req, res) {
        try {

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });


            var optionField = ['1-15', '16-30', '31-40', '41-45', '46-48', '49-75'];
            let pattern = await Sys.App.Services.patternServices.getByData({ gameType: gameType.type });

            var disabledOptionField = [];
            if (gameType.type == "game_3") {
                for (var i = 0; i < pattern.length; i++) {
                    if (pattern[i].gameType == 'game_3') {
                        if (pattern[i].patternPlace == '1-15') {
                            console.log("pattern[i].count", pattern[i].count);
                            if (pattern[i].count > 2) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        } else if (pattern[i].patternPlace == '16-30') {
                            if (pattern[i].count > 6) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        } else if (pattern[i].patternPlace == '31-40') {
                            if (pattern[i].count > 8) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        } else if (pattern[i].patternPlace == '41-45') {
                            if (pattern[i].count > 4) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        } else if (pattern[i].patternPlace == '46-48') {
                            if (pattern[i].count > 1) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        } else if (pattern[i].patternPlace == '49-75') {
                            if (pattern[i].count > -1) {
                                disabledOptionField.push(pattern[i].patternPlace);
                            }
                        }
                    }
                }
            }

            let keys = [
                "view",
                "Pattern.gameName",
                "viewPattern.pattern_management",
                "dashboard",
                "pattern_name",
                "pattern_draw",
                "do_you_want_to_display_wheel_of_fortune",
                "yes",
                "no",
                "do_you_want_to_display_treasure_chest",
                "do_you_want_to_display_mystery",
                "do_you_want_to_row_percentage",
                "enter_extra_percentage_spillernes_spill",
                "do_you_want_to_assign_jackpot_on.this_pattern",
                "do_you_want_to_use_this_pattern_for_extra_game",
                "creation_date_time",
                "status",
                "action",
                "inactive",
                "cancel",
                "pattern_management",
                "add",
                "edit_text",
                "submit"
            ]
            let patterns = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
           
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PatternMenu: 'active',
                gameData: gameType,
                slug: 'Add',
                optionField: optionField,
                disabledOptionField: disabledOptionField,
                viewPattern: patterns,
                navigation: patterns
            };
            return res.render('patternManagement/addPattern', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    checkForPatternName: async function (req, res) {
        try {
            console.log("req.body", req.body);
            let gameName = '^' + req.body.patternName + '$';
            let gameCount = await Sys.App.Services.patternServices.getCount({ 'gameName': req.body.gameName, 'patternName': { '$regex': gameName, $options: 'i', } });
            if (req.body.patternId != '') {
                gameCount = await Sys.App.Services.patternServices.getCount({ _id: { $ne: req.body.patternId }, 'gameName': req.body.gameName, 'patternName': { '$regex': gameName, $options: 'i', } });
            }
            if (gameCount == 0) {
                return res.send({ "valid": true });
            }
            return res.send({ "valid": false, "message": "Game Name must be Different." });
        } catch (e) {
            console.log("Error in ", e);
        }
    },

    addPatternPostData: async function (req, res) {
        try {
            //console.log("addPatternPostData params", req.params.typeId, req.params.type);
            console.log("addPatternPostData", req.body, req.params);

            if (req.body.patternName == '') {
                req.flash("error", 'Fail because Pattern Name is empty..');
                return res.redirect('/addPattern/' + req.params.typeId);
            }

            var Pattern;
            var ID = Date.now()
            var createID = dateTimeFunction(ID);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                let miliSeconds = dt.getMilliseconds();
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + '' + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }

            let patternList = await Sys.App.Services.patternServices.getByData({ gameType: req.params.type });

            var patternPlaceCount = 0;
            for (var i = 0; i < patternList.length; i++) {
                if (req.body.place == patternList[i].patternPlace) {
                    patternPlaceCount = patternList[i].count + 1;
                }
            }

            if (req.params.type == "game_1") {

                // Check gameName Avilable
                let patternName = '^' + req.body.patternName + '$';
                let patternNameCount = await Sys.App.Services.patternServices.getCount({ 'patternName': { '$regex': patternName, $options: 'i' } });
                if (patternNameCount > 0) {
                    req.flash('error', 'Something went Wrong.');
                    return res.redirect('/patternGameDetailList/' + req.params.typeId);
                }

                let stringPatternConvertInArray = get2DArrayFromString(req.body.d2ArrayValues);

                function get2DArrayFromString(s) {
                    let arr = s.replace(/\./g, ",");
                    arr = arr.split`,`.map(x => +x);
                    return arr;
                }

                let patternArr = [];
                stringPatternConvertInArray.forEach(function (currentValue, index) {
                    if (currentValue == 1) {
                        patternArr.push(index);
                    }
                });

                patType = req.body.patternName.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                    return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                }).replace(/\s+/g, '');

                Pattern = await Sys.App.Services.patternServices.insertGamePatternData({
                    gameName: 'Game1',
                    gameType: req.params.type,
                    patternNumber: createID + '_G1Pattern',
                    patternName: req.body.patternName,
                    patternType: req.body.d2ArrayValues,
                    patternPlace: req.body.place,
                    count: patternPlaceCount,
                    status: req.body.status,
                    gameOnePatternType: patternArr,
                    patType: patType,
                    rowPercentage: (req.body.rowPercentage == '') ? 0 : req.body.rowPercentage,
                    isWoF: (req.body.wheelYes == 'yes') ? true : false,
                    isTchest: (req.body.treasureYes == 'yes') ? true : false,
                    isMys: (req.body.mysteryYes == 'yes') ? true : false,
                    isRowPr: (req.body.rowPr == 'yes') ? true : false,
                    isJackpot: (req.body.jackpotYes == 'yes') ? true : false,
                    isGameTypeExtra: (req.body.isGameTypeExtra == 'yes') ? true : false,
                    isLuckyBonus: (req.body.luckyBonusYes == 'yes') ? true : false,
                    //creationDateTime: ((req.body.start_date)?(req.body.start_date):(new Date()))
                });
            } else if (req.params.type == "game_3") {
                console.log('req.body.d2ArrayValues', req.body.d2ArrayValues);
                if (req.body.d2ArrayValues.indexOf('1') < 0) {
                    req.flash("error", 'Please select atleast one pattern box');
                    return res.redirect('/addPattern/' + req.params.typeId);
                }
                let checkPattern = await Sys.App.Services.patternServices.getSingleGamePatternData({ patternName: req.body.patternName });
                console.log('checkPattern', checkPattern);
                if (checkPattern) {
                    req.flash("error", 'Pattern name is already exist');
                    return res.redirect('/addPattern/' + req.params.typeId);
                }

                Pattern = await Sys.App.Services.patternServices.insertGamePatternData({
                    gameName: 'Game3',
                    gameType: req.params.type,
                    patternNumber: createID + '_G3Pattern',
                    patternName: req.body.patternName,
                    patternType: req.body.d2ArrayValues,
                    // patternPlace: req.body.place,
                    count: patternPlaceCount
                });
            } else if (req.params.type == "game_4") {
                Pattern = await Sys.App.Services.patternServices.insertGamePatternData({
                    gameName: 'Game4',
                    gameType: req.params.type,
                    patternNumber: createID + '_G4Pattern',
                    patternName: req.body.patternName,
                    patternType: req.body.d2ArrayValues,
                    patternPlace: req.body.place,
                    count: patternPlaceCount
                });
            }

            if (!Pattern) {
                req.flash('error', 'Pattern was not created');
                return res.redirect('/patternGameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Pattern was create successfully');
                return res.redirect('/patternGameDetailList/' + req.params.typeId);
            }


        } catch (e) {
            console.log("Error", e);
        }
    },


    editPattern: async function (req, res) {
        try {
            //console.log("editPattern", req.params);

            let pattern = await Sys.App.Services.patternServices.getByIdPattern({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            // var creationDate = (pattern.creationDate == null) ? '' : dateTimeFunction(pattern.creationDate);

            // function dateTimeFunction(dateData) {
            //     let dt = new Date(dateData);
            //     let date = dt.getDate();
            //     let month = parseInt(dt.getMonth() + 1);
            //     let year = dt.getFullYear();
            //     let hours = dt.getHours();
            //     let minutes = dt.getMinutes();
            //     // let ampm = hours >= 12 ? 'pm' : 'am';
            //     // hours = hours % 12;
            //     // hours = hours ? hours : 12;
            //     minutes = minutes < 10 ? '0' + minutes : minutes;
            //     let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes;
            //     return dateTime; // Function returns the dateandtime
            // }

            let keys = [
                "view",
                "Pattern.gameName",
                "viewPattern.pattern_management",
                "dashboard",
                "pattern_name",
                "pattern_draw",
                "do_you_want_to_display_wheel_of_fortune",
                "yes",
                "no",
                "do_you_want_to_display_treasure_chest",
                "do_you_want_to_display_mystery",
                "do_you_want_to_row_percentage",
                "enter_extra_percentage_spillernes_spill",
                "do_you_want_to_assign_jackpot_on.this_pattern",
                "do_you_want_to_use_this_pattern_for_extra_game",
                "creation_date_time",
                "status",
                "action",
                "inactive",
                "cancel",
                "pattern_management",
                "add",
                "edit_text",
                "submit"
            ]
            let patterns = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)


            //console.log("Game", Game);
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PatternMenu: 'active',
                slug: 'Edit',
                pattern: pattern,
                gameData: gameType,
                viewPattern: patterns,
                navigation: patterns
                //creationDate: creationDate
            };
            return res.render('patternManagement/addPattern', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editPatternPostData: async function (req, res) {
        try {

            console.log("editPatternPostData", req.params, req.body);

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;

            if (gameType.type == "game_1") {
                updateGame = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: req.params.id });
                if (updateGame != undefined) {
                    let stringPatternConvertInArray = get2DArrayFromString(req.body.d2ArrayValues);

                    function get2DArrayFromString(s) {
                        let arr = s.replace(/\./g, ",");
                        arr = arr.split`,`.map(x => +x);
                        return arr;
                    }

                    let patternArr = [];
                    stringPatternConvertInArray.forEach(function (currentValue, index) {
                        if (currentValue == 1) {
                            patternArr.push(index);
                        }
                    });

                    // Check gameName Avilable
                    let patternName = '^' + req.body.patternName + '$';
                    let patternNameCount = await Sys.App.Services.patternServices.getCount({ 'patternName': { '$regex': patternName, $options: 'i' } });

                    if (updateGame.patternName == req.body.patternName) { } else {
                        if (patternNameCount > 0) {
                            req.flash('error', 'Please Enter Unique Pattern name..!!');
                            return res.redirect('/patternGameDetailList/' + req.params.typeId);
                        }
                    }
                    patType = req.body.patternName.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                        return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                    }).replace(/\s+/g, '');

                    let data = {
                        patternName: req.body.patternName,
                        patternType: req.body.d2ArrayValues,
                        status: req.body.status,
                        gameOnePatternType: patternArr,
                        patType: patType,
                        rowPercentage: (req.body.rowPercentage == '') ? 0 : req.body.rowPercentage,
                        isWoF: (req.body.wheelYes == 'yes') ? true : false,
                        isTchest: (req.body.treasureYes == 'yes') ? true : false,
                        isMys: (req.body.mysteryYes == 'yes') ? true : false,
                        isRowPr: (req.body.rowPr == 'yes') ? true : false,
                        isJackpot: (req.body.jackpotYes == 'yes') ? true : false,
                        isGameTypeExtra: (req.body.isGameTypeExtra == 'yes') ? true : false,
                        isLuckyBonus: (req.body.luckyBonusYes == 'yes') ? true : false,
                        // creationDateTime: ((req.body.start_date)?(req.body.start_date):(new Date(updateGame.creationDateTime)))
                    }
                    await Sys.App.Services.patternServices.updateOneGamePattern({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_3") {
                if (req.body.d2ArrayValues.indexOf('1') < 0) {
                    req.flash("error", 'Please select atleast one pattern box');
                    return res.redirect(`/patternEdit/${req.params.typeId}/${req.params.id}`);
                }
                let checkPattern = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: { $ne: req.params.id }, patternName: req.body.patternName });
                console.log('checkPattern', checkPattern);
                if (checkPattern) {
                    req.flash("error", 'Pattern name is already exist');
                    return res.redirect(`/patternEdit/${req.params.typeId}/${req.params.id}`);
                }
                updateGame = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: req.params.id });
                if (updateGame != undefined) {
                    let data = {
                        patternName: req.body.patternName,
                        patternType: req.body.d2ArrayValues,
                    }
                    await Sys.App.Services.patternServices.updateOneGamePattern({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {
                updateGame = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: req.params.id });
                if (updateGame != undefined) {
                    let data = {
                        patternName: req.body.patternName,
                        patternType: req.body.d2ArrayValues,
                        patternPrice: req.body.patternPrice
                    }
                    await Sys.App.Services.patternServices.updateOneGamePattern({ _id: req.params.id }, data)
                }
            }

            if (!updateGame) {
                req.flash('error', 'Pattern was not updated');
                return res.redirect('/patternGameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Pattern was updated successfully');
                return res.redirect('/patternGameDetailList/' + req.params.typeId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getPatternDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: req.body.id });
            if (player || player.length > 0) {

                if (player.gameName == 'Game1') {


                    await Sys.App.Services.patternServices.deleteGamePattern(req.body.id)

                    let update = await Sys.App.Services.patternServices.updateManyData({
                        "gameName": "Game1",
                        count: { $gt: 0 }
                    }, { $inc: { count: -1 } });

                    console.log("update", update);
                    return res.send("success");
                } else {
                    let data = await Sys.App.Services.patternServices.getByDataLastData({ patternPlace: player.patternPlace });
                    console.log("data", data);

                    let update = await Sys.App.Services.patternServices.updateOneGamePattern({ _id: data[0]._id, patternPlace: player.patternPlace }, {
                        count: data[0].count - 1
                    });

                    await Sys.App.Services.patternServices.deleteGamePattern(req.body.id)
                    return res.send("success");
                }


            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewPatternDetails: async function (req, res) {
        try {
            let dataGame = await Sys.App.Services.patternServices.getByIdPattern({ _id: req.params.id });

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var creationDate = (dataGame.creationDate == null) ? '' : dateTimeFunction(dataGame.creationDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                // let ampm = hours >= 12 ? 'pm' : 'am';
                // hours = hours % 12;
                // hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes;
                return dateTime; // Function returns the dateandtime
            }

            let keys = [
                "view",
                "Pattern.gameName",
                "viewPattern.pattern_management",
                "dashboard",
                "pattern_name",
                "pattern_draw",
                "do_you_want_to_display_wheel_of_fortune",
                "yes",
                "no",
                "do_you_want_to_display_treasure_chest",
                "do_you_want_to_display_mystery",
                "do_you_want_to_row_percentage",
                "enter_extra_percentage_spillernes_spill",
                "do_you_want_to_assign_jackpot_on.this_pattern",
                "do_you_want_to_use_this_pattern_for_extra_game",
                "creation_date_time",
                "status",
                "action",
                "active",
                "inactive",
                "cancel",
                "submit"
            ]
            let patterns = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PatternMenu: 'active',
                Pattern: dataGame,
                gameData: gameType,
                creationDate: creationDate,
                viewPattern: patterns,
                navigation: patterns
            };
            return res.render('patternManagement/viewPatternDetails', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    checkGame5Patterns: async function (req, res) {
        try {

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                let miliSeconds = dt.getMilliseconds();
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + '' + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }

            let patternList = await Sys.App.Services.patternServices.getByData({ gameType: "game_5" });
            console.log("patternList--", patternList.length)
            if (patternList.length <= 0) {
                let patterns = [
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "1_G5Pattern",
                        patternName: "Jackpot 1",
                        patternType: "1,1,1.1,1,1.1,1,1",
                        fixedPatternType: ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2", "2:0", "2:1", "2:2"],
                        count: 1
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "2_G5Pattern",
                        patternName: "Jackpot 2",
                        patternType: "1,1,1.1,0.1.1,1,1",
                        fixedPatternType: ["0:0", "0:1", "0:2", "1:0", "1:2", "2:0", "2:1", "2:2"],
                        count: 2
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "3_G5Pattern",
                        patternName: "Bonus 1",
                        patternType: "1,1,1.1,1,1.1,1,0",
                        fixedPatternType: ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2", "2:0", "2:1"],
                        count: 3
                    },


                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "4_G5Pattern",
                        patternName: "Bonus 2",
                        patternType: "1,1,1.0,1,0.1,1,1",
                        fixedPatternType: ["0:0", "0:1", "0:2", "1:1", "2:0", "2:1", "2:2"],
                        count: 4
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "5_G5Pattern",
                        patternName: "Bonus 3",
                        patternType: "1,0,1.1,0,1.1,1,1",
                        fixedPatternType: ["0:0", "0:2", "1:0", "1:2", "2:0", "2:1", "2:2"],
                        count: 5
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "6_G5Pattern",
                        patternName: "Bonus 4",
                        patternType: "0,1,1.1,1,1.1,1,0",
                        fixedPatternType: ["0:1", "0:2", "1:0", "1:1", "1:2", "2:0", "2:1"],
                        count: 6
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "7_G5Pattern",
                        patternName: "Bonus 5",
                        patternType: "1,1,1.0,0,0.1,1,1",
                        fixedPatternType: ["0:0", "0:1", "0:2", "2:0", "2:1", "2:2"],
                        count: 7
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "8_G5Pattern",
                        patternName: "Bonus 6",
                        patternType: "1,0,1.1,1,0.0,1,1",
                        fixedPatternType: ["0:0", "0:2", "1:0", "1:1", "2:1", "2:2"],
                        count: 8
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "9_G5Pattern",
                        patternName: "Bonus 7",
                        patternType: "0,1,0.1,1,1.0,1,0",
                        fixedPatternType: ["0:1", "1:0", "1:1", "1:2", "2:1"],
                        count: 9
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "10_G5Pattern",
                        patternName: "Bonus 8",
                        patternType: "1,0,1.0,1,0.1,0,1",
                        fixedPatternType: ["0:0", "0:2", "1:1", "2:0", "2:2"], //"1:0", "1:2"
                        count: 10
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "11_G5Pattern",
                        patternName: "Bonus 9",
                        patternType: "1,0,0.1,0,0.1,1,1",
                        fixedPatternType: ["0:0", "1:0", "2:0", "2:1", "2:2"],
                        count: 11
                    }, {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "12_G5Pattern",
                        patternName: "Bonus 10",
                        patternType: "1,1,1.0,1,0.0,1,0",
                        fixedPatternType: ["0:0", "0:1", "0:2", "1:1", "2:1"],
                        count: 12
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "13_G5Pattern",
                        patternName: "Pattern 1",
                        patternType: "0,1,0.1,0,1.0,1,0",
                        fixedPatternType: ["0:1", "1:0", "1:2", "2:1"],
                        count: 13
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "14_G5Pattern",
                        patternName: "Pattern 2",
                        patternType: "1,0,1.0,0,0.1,0,1",
                        fixedPatternType: ["0:0", "0:2", "2:0", "2:2"],
                        count: 14
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "15_G5Pattern",
                        patternName: "Pattern 3",
                        patternType: "0,0,0.1,1,1.0,0,0",
                        fixedPatternType: ["1:0", "1:1", "1:2"],
                        count: 15
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "16_G5Pattern",
                        patternName: "Pattern 4",
                        patternType: "0,1,0.1,1,1.1,0,0",
                        fixedPatternType: ["0:1", "1:0", "1:1", "1:2", "2:0"],
                        count: 16
                    },
                    {
                        gameName: "Game5",
                        gameType: "game_5",
                        patternNumber: dateTimeFunction(Date.now()) + "17_G5Pattern",
                        patternName: "Pattern 5",
                        patternType: "0,0,0.0,0,0.0,0,0",
                        fixedPatternType: [],
                        count: 17
                    }

                ]
                await Sys.App.Services.patternServices.insertManyData(patterns, {});
            }
            return true;

        } catch (e) {
            console.log("Error", e);
        }
    },
}