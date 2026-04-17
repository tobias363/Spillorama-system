var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');

module.exports = {
    // [ Game Type ]
    subGame1: async function (req, res) {
        try {

            let key = []
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;

            console.log("stringReplace", req.session.details.isPermission);

            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['SubGame Management'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }

            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                subGameActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                translate,
                navigation: translate
            };
            return res.render('subGameList/gamelist', data);
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    subGame1List: async function (req, res) {
        try {

            let order = req.query.order;
            let sort = {};

            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { gameName: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.subGame1Services.getCount(query);

            let data = await Sys.App.Services.subGame1Services.getDatatable(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (error) {
            console.log("error", error);
        }
    },

    addSubGame: async function (req, res) {
        try {

            let key = []
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let pattern = await Sys.App.Services.patternServices.getByData({ gameName: "Game1", status: 'active' });

            let ticketColors = [
                'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
                'Large Purple', 'Small Blue', 'Large Blue', 'Red', 'Yellow', 'Green',
                'Elvis 1', 'Elvis 2', 'Elvis 3', 'Elvis 4', 'Elvis 5'
            ];


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                subGameActive: 'active',
                patternRowArr: pattern,
                ticketColors: ticketColors,
                translate,
                navigation: translate
            };

            return res.render('subGameList/add', data);

        } catch (error) {
            console.log("Error in Sub Game Add :-", error);
        }
    },

    checkForGameName: async function (req, res) {
        try {

            console.log("req", req.body);
            let gameName = '^' + req.body.gameName + '$';
            console.log("gameName", gameName);
            let gameCount = await Sys.App.Services.subGame1Services.getCount({ 'gameName': { '$regex': gameName, $options: 'i' } });
            console.log("gameCount", gameCount);
            if (gameCount == 0) {
                return res.send({ "valid": true });
            }
            return res.send({ "valid": false, "message": await Sys.Helper.bingo.getSingleTraslateData(["game_name_must_be_diff"], req.session.details.language) });
        } catch (e) {
            console.log("Error in ", e)
        }
    },

    addSubGamePostData: async function (req, res) {
        try {
            console.log("req.body", req.body);

            // Check gameName Avilable
            let gameName = '^' + req.body.gameName + '$';
            let gameCount = await Sys.App.Services.subGame1Services.getCount({ 'gameName': { '$regex': gameName, $options: 'i' } });
            if (gameCount > 0) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["game_name_must_be_diff"], req.session.details.language));
                return res.redirect('/subGame');
            }

            var ID = Date.now()
            var createID = await Sys.Helper.bingo.dateTimeFunction(ID);
            let patternArray = [];
            let selectedPatternRow = req.body.selectPatternRow;
            let selectedPatternRowData, selectedPatternRowObj = {};
            let allPatternTabaleId = [];

            if (selectedPatternRow == undefined) {
                patternArray = [];
            } else if (typeof (selectedPatternRow) === 'string') {
                console.log("selectedPatternRow ::-->>", selectedPatternRow);
                let selectRowPatternId = await Sys.Helper.bingo.obId(selectedPatternRow);
                selectedPatternRowData = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: selectRowPatternId });
                if (!selectedPatternRowData) {
                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["selected_row_pattern_not_found"], req.session.details.language));
                    return res.redirect('/subGame');
                } else {
                    selectedPatternRowObj = {
                        _id: selectedPatternRowData._id,
                        name: selectedPatternRowData.patternName,
                        patternId: selectedPatternRowData.patternNumber,
                        patternType: selectedPatternRowData.gameOnePatternType,
                        patType: selectedPatternRowData.patType,
                        isWoF: selectedPatternRowData.isWoF,
                        isTchest: selectedPatternRowData.isTchest,
                        isMys: selectedPatternRowData.isMys,
                        isRowPr: selectedPatternRowData.isRowPr,
                        rowPercentage: selectedPatternRowData.rowPercentage,
                        status: selectedPatternRowData.status,
                        isJackpot: selectedPatternRowData.isJackpot,
                        isGameTypeExtra: selectedPatternRowData.isGameTypeExtra,
                        isLuckyBonus: selectedPatternRowData.isLuckyBonus,
                    }
                    patternArray.push(selectedPatternRowObj);
                    allPatternTabaleId.push(selectedPatternRowData._id);
                }
            } else {
                for (var i = 0; i < selectedPatternRow.length; i++) {
                    let selectRowPatternId = await Sys.Helper.bingo.obId(selectedPatternRow[i]);
                    selectedPatternRowData = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: selectRowPatternId });
                    if (!selectedPatternRowData) {
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["selected_row_pattern_not_found"], req.session.details.language));
                        return res.redirect('/subGame');
                    } else {
                        selectedPatternRowObj = {
                            _id: selectedPatternRowData._id,
                            name: selectedPatternRowData.patternName,
                            patternId: selectedPatternRowData.patternNumber,
                            patternType: selectedPatternRowData.gameOnePatternType,
                            patType: selectedPatternRowData.patType,
                            isWoF: selectedPatternRowData.isWoF,
                            isTchest: selectedPatternRowData.isTchest,
                            isMys: selectedPatternRowData.isMys,
                            isRowPr: selectedPatternRowData.isRowPr,
                            rowPercentage: selectedPatternRowData.rowPercentage,
                            status: selectedPatternRowData.status,
                            isJackpot: selectedPatternRowData.isJackpot,
                            isGameTypeExtra: selectedPatternRowData.isGameTypeExtra,
                            isLuckyBonus: selectedPatternRowData.isLuckyBonus,
                        }
                        patternArray.push(selectedPatternRowObj);
                        allPatternTabaleId.push(selectedPatternRowData._id);
                    }
                }
            }

            let ColorArr = [];
            let tColor;
            if (typeof (req.body.selectTicketColor) === 'string') {
                let obj = {
                    name: req.body.selectTicketColor,
                };

                let str = req.body.selectTicketColor.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                    return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                }).replace(/\s+/g, '');
                obj.type = str;
                ColorArr.push(obj);
            } else {
                tColor = req.body.selectTicketColor.forEach(function (currentValue, index) {
                    let obj = {
                        name: currentValue,
                    }
                    let str = currentValue.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                        return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                    }).replace(/\s+/g, '');
                    obj.type = str;
                    ColorArr.push(obj);
                });
            }


            let check = await Sys.App.Services.subGame1Services.insertData({
                subGameId: createID + '_SubGame',
                gameName: req.body.gameName.trim(),
                patternRow: patternArray,
                allPatternRowId: allPatternTabaleId,
                status: req.body.status,
                //creationDateTime: ((req.body.start_date)?req.body.start_date:new Date()),
                ticketColor: ColorArr,
                gameType: req.body.gameName.toLowerCase().trim().replace(/ /g, "_"),
            });

            req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["sub_game_add_successfully"], req.session.details.language));
            return res.redirect('/subGame');

        } catch (error) {
            console.log("Error in addSubGamePostData :-", error);
        }
    },

    editSubGame: async function (req, res) {
        try {
            let key = []
            let translate = await Sys.Helper.bingo.getSingleTraslateData(key, req.session.details.language)

            let subGame = await Sys.App.Services.subGame1Services.getById({ _id: req.params.id });

            let patternRowArr = await Sys.App.Services.patternServices.getByData({ gameName: "Game1" });


            // let creationDate = dateTimeFunction(subGame.creationDate)

            // function dateTimeFunction(dateData) {
            //     let dt = new Date(dateData);
            //     let date = dt.getDate();
            //     let month = parseInt(dt.getMonth() + 1);
            //     let year = dt.getFullYear();
            //     let hours = dt.getHours();
            //     let minutes = dt.getMinutes();
            //     let ampm = hours >= 12 ? 'pm' : 'am';
            //     hours = hours % 12;
            //     hours = hours ? hours : 12;
            //     minutes = minutes < 10 ? '0' + minutes : minutes;
            //     let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes;
            //     return dateTime; // Function returns the dateandtime
            // }

            let ticketColors = [
                'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
                'Large Purple', 'Small Blue', 'Large Blue', 'Red', 'Yellow', 'Green',
                'Elvis 1', 'Elvis 2', 'Elvis 3', 'Elvis 4', 'Elvis 5'
            ];


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                subGameActive: 'active',
                patternRowArr: patternRowArr,
                subGame: subGame,
                //creationDate: creationDate,
                ticketColors: ticketColors,
                translate,
                navigation: translate
            };
            return res.render('subGameList/add', data);
        } catch (error) {
            console.log("editSubGame error", error);
        }
    },

    editSubGamePostData: async function (req, res) {
        try {

            console.log("req.body", req.body);

            let subGame = await Sys.App.Services.subGame1Services.getSingleData({ _id: req.params.id });

            if (!subGame) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["sub_game_not_found"], req.session.details.language));
                return res.redirect('/subGame');
            }

            // let gameName = '^' + req.body.gameName + '$';
            // let gameCount = await Sys.App.Services.subGame1Services.getCount({ 'gameName': { '$regex': gameName, $options: 'i' } });
            // if (gameCount > 0) {
            //     req.flash('error', 'Game Name must be Different');
            //     return res.redirect('/subGame');
            // }


            let patternArray = [];
            let selectedPatternRow = req.body.selectPatternRow;
            let selectedPatternRowData, selectedPatternRowObj = {};
            let allPatternTabaleId = [];

            if (selectedPatternRow == undefined) {
                patternArray = [];
            } else if (typeof (selectedPatternRow) === 'string') {
                console.log("selectedPatternRow ::-->>", selectedPatternRow);
                let selectRowPatternId = await Sys.Helper.bingo.obId(selectedPatternRow);
                selectedPatternRowData = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: selectRowPatternId });
                if (!selectedPatternRowData) {
                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["selected_row_pattern_not_found"], req.session.details.language));
                    return res.redirect('/subGame');
                } else {
                    selectedPatternRowObj = {
                        _id: selectedPatternRowData._id,
                        name: selectedPatternRowData.patternName,
                        patternId: selectedPatternRowData.patternNumber,
                        patternType: selectedPatternRowData.gameOnePatternType,
                        patType: selectedPatternRowData.patType,
                        isWoF: selectedPatternRowData.isWoF,
                        isTchest: selectedPatternRowData.isTchest,
                        isMys: selectedPatternRowData.isMys,
                        isRowPr: selectedPatternRowData.isRowPr,
                        rowPercentage: selectedPatternRowData.rowPercentage,
                        status: selectedPatternRowData.status,
                        isJackpot: selectedPatternRowData.isJackpot,
                        isGameTypeExtra: selectedPatternRowData.isGameTypeExtra,
                        isLuckyBonus: selectedPatternRowData.isLuckyBonus,
                    }
                    patternArray.push(selectedPatternRowObj);
                    allPatternTabaleId.push(selectedPatternRowData._id);
                }
            } else {
                for (var i = 0; i < selectedPatternRow.length; i++) {
                    let selectRowPatternId = await Sys.Helper.bingo.obId(selectedPatternRow[i]);
                    selectedPatternRowData = await Sys.App.Services.patternServices.getSingleGamePatternData({ _id: selectRowPatternId });
                    if (!selectedPatternRowData) {
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["selected_row_pattern_not_found"], req.session.details.language));
                        return res.redirect('/subGame');
                    } else {
                        selectedPatternRowObj = {
                            _id: selectedPatternRowData._id,
                            name: selectedPatternRowData.patternName,
                            patternId: selectedPatternRowData.patternNumber,
                            patternType: selectedPatternRowData.gameOnePatternType,
                            patType: selectedPatternRowData.patType,
                            isWoF: selectedPatternRowData.isWoF,
                            isTchest: selectedPatternRowData.isTchest,
                            isMys: selectedPatternRowData.isMys,
                            isRowPr: selectedPatternRowData.isRowPr,
                            rowPercentage: selectedPatternRowData.rowPercentage,
                            status: selectedPatternRowData.status,
                            isJackpot: selectedPatternRowData.isJackpot,
                            isGameTypeExtra: selectedPatternRowData.isGameTypeExtra,
                            isLuckyBonus: selectedPatternRowData.isLuckyBonus,
                        }
                        patternArray.push(selectedPatternRowObj);
                        allPatternTabaleId.push(selectedPatternRowData._id);
                    }
                }
            }


            let ColorArr = [];
            let tColor;
            if (typeof (req.body.selectTicketColor) === 'string') {
                let obj = {
                    name: req.body.selectTicketColor,
                };

                let str = req.body.selectTicketColor.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                    return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                }).replace(/\s+/g, '');
                obj.type = str;
                ColorArr.push(obj);
            } else {
                tColor = req.body.selectTicketColor.forEach(function (currentValue, index) {
                    let obj = {
                        name: currentValue,
                    }
                    let str = currentValue.replace(/(?:^.|[A-Z]|\b.)/g, function (letter, index) {
                        return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                    }).replace(/\s+/g, '');
                    obj.type = str;
                    ColorArr.push(obj);
                });
            }

            let data = {
                gameName: req.body.gameName.trim(),
                patternRow: patternArray,
                allPatternRowId: allPatternTabaleId,
                status: req.body.status,
                //creationDateTime: (req.body.start_date) ? req.body.start_date : subGame.creationDateTime,
                ticketColor: ColorArr,
                gameType: req.body.gameName.toLowerCase().trim().replace(/ /g, "_"),
            }

            await Sys.App.Services.subGame1Services.updateData({ _id: req.params.id }, data)

            req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["sub_game_update"], req.session.details.language));
            return res.redirect('/subGame');

        } catch (error) {
            console.log("editSubGamePostData error", error);
        }
    },

    getSubGameDelete: async function (req, res) {
        try {
            let item = await Sys.App.Services.subGame1Services.getSingleData({ _id: req.body.id });
            if (item || item.length > 0) {
                await Sys.App.Services.subGame1Services.delete(item._id)
                return res.send("success");
            } else {
                return res.send("error");
            }

        } catch (error) {
            console.log("Error in getSubGameDelete :-", error);
        }
    },

    viewSubGame: async function (req, res) {
        try {
            let key = []
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let item = await Sys.App.Services.subGame1Services.getSingleData({ _id: req.params.id });
            // let creationDate = dateTimeFunction(item.creationDate)

            // function dateTimeFunction(dateData) {
            //     let dt = new Date(dateData);
            //     let date = dt.getDate();
            //     let month = parseInt(dt.getMonth() + 1);
            //     let year = dt.getFullYear();
            //     let hours = dt.getHours();
            //     let minutes = dt.getMinutes();
            //     let ampm = hours >= 12 ? 'pm' : 'am';
            //     hours = hours % 12;
            //     hours = hours ? hours : 12;
            //     minutes = minutes < 10 ? '0' + minutes : minutes;
            //     let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
            //     return dateTime; // Function returns the dateandtime
            // }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                subGameActive: 'active',
                subGame: item,
                //creationDate: creationDate,
                translate,
                navigation : translate
            };
            return res.render('subGameList/view', data);

        } catch (error) {
            console.log("Error in viewSubGame :-", error);
        }
    },


}