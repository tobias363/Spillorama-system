var Sys = require('../../Boot/Sys');
const moment = require('moment');

module.exports = {

    // [ Wheel Of Fortune ]
    wheelOfFortune: async function(req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Other Games'] || [];
                let stringReplace =req.session.details.isPermission['Other Games'] || [];
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
            let wheelOfFortune = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
            const keysArray = [
                "wheel_of_fortune",
                "dashboard",
                "game",
                "submit",
                "cancel"
            ];
            let otherGame = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                wheelOfFortune: 'active',
                otherGamesMenu: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                prizeList: (wheelOfFortune) ? wheelOfFortune.wheelOfFortuneprizeList : [],
                otherGame: otherGame,
                navigation: otherGame
            };
            return res.render('otherGames/wheelOfFortune', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editWheelOfFortune: async function(req, res) {
        try {
            
            let wheelOfFortune = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });

            var priceList = req.body.price.map(function(x) {
                return parseInt(x, 10);
            });

            if (wheelOfFortune == null) {
                await Sys.App.Services.otherGameServices.insertData({
                    wheelOfFortuneprizeList: priceList,
                    slug: 'wheelOfFortune'
                });
            } else {
                await Sys.App.Services.otherGameServices.updateData({ _id: wheelOfFortune._id }, {
                    wheelOfFortuneprizeList: priceList
                })
            }

            req.flash('success', 'Wheel Of Fortune Updated Successfully!');
            return res.redirect('/wheelOfFortune')

        } catch (e) {
            console.log("Error", e);
        }
    },

    treasureChest: async function(req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Other Games'] || [];
                let stringReplace =req.session.details.isPermission['Other Games'] || [];
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
            let treasureChest = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
            const keysArray = [
                "treasure_chest",
                "dashboard",
                "game",
                "cancel",
                "treasure_chest_prize",
                "submit"
            ];
            let otherGame = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                treasureChest: 'active',
                otherGamesMenu: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                prizeList: (treasureChest) ? treasureChest.treasureChestprizeList : [],
                otherGame: otherGame,
                navigation: otherGame
            };
            return res.render('otherGames/treasureChest', data);

        } catch (e) {
            console.log("Error", e);
        }
    },



    editTreasureChestPostData: async function(req, res) {
        try {

            let treasureChest = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });

            var priceList = req.body.price.map(function(x) {
                return parseInt(x, 10);
            });

            if (treasureChest == null) {
                await Sys.App.Services.otherGameServices.insertData({
                    treasureChestprizeList: priceList,
                    slug: 'treasureChest'
                });
            } else {
                await Sys.App.Services.otherGameServices.updateData({ _id: treasureChest._id }, {
                    treasureChestprizeList: priceList
                })
            }

            req.flash('success', 'Treasure Chest data updated successfully');
            return res.redirect('/treasureChest')

        } catch (e) {
            console.log("Error", e);
        }
    },



    mystery: async function(req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Other Games'] || [];
                let stringReplace =req.session.details.isPermission['Other Games'] || [];
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
            let mystery = await Sys.App.Services.otherGameServices.getByData({ slug: 'mystery' });
            const keysArray = [
                "mystery",
                "dashboard",
                "game",
                "cancel",
                "mystery_game_prize",
                "submit"
            ];
            let otherGame = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mysteryGame: 'active',
                otherGamesMenu: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                prizeList: (mystery) ? mystery.mysteryPrizeList : [],
                otherGame: otherGame,
                navigation: otherGame
            };
            return res.render('otherGames/mysteryGame', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editMysteryPostData: async function(req, res) {
        try {

            let mystery = await Sys.App.Services.otherGameServices.getByData({ slug: 'mystery' });

            var priceList = req.body.price.map(function(x) {
                return parseInt(x, 10);
            });

            if (mystery == null) {
                await Sys.App.Services.otherGameServices.insertData({
                    mysteryPrizeList: priceList,
                    slug: 'mystery'
                });
            } else {
                await Sys.App.Services.otherGameServices.updateData({ _id: mystery._id }, {
                    mysteryPrizeList: priceList
                })
            }

            req.flash('success', 'Mystery Game data updated successfully');
            return res.redirect('/mystery')

        } catch (e) {
            console.log("Error", e);
        }
    },

    colorDraft: async function(req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Other Games'] || [];
                let stringReplace =req.session.details.isPermission['Other Games'] || [];
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
            let colordraft = await Sys.App.Services.otherGameServices.getByData({ slug: 'colorDraft' });
            console.log("colordraft", colordraft)
            let redPrizes = [], yellowPrizes = [], greenPrizes = [];
            if(colordraft && colordraft.colordraftPrizeList && colordraft.colordraftPrizeList.length > 0 ){
                for(let p =0; p < colordraft.colordraftPrizeList.length; p++){
                    if(colordraft.colordraftPrizeList[p].color == "red"){
                        redPrizes.push(colordraft.colordraftPrizeList[p].amount);
                    }else if(colordraft.colordraftPrizeList[p].color == "yellow"){
                        yellowPrizes.push(colordraft.colordraftPrizeList[p].amount);
                    }else if(colordraft.colordraftPrizeList[p].color == "green"){
                        greenPrizes.push(colordraft.colordraftPrizeList[p].amount);
                    }
                }
            }

            const keysArray = [
                "color_draft",
                "dashboard",
                "game",
                "cancel",
                "submit",
                "red_color_prize",
                "yellow_color_prize",
                "green_color_prize"
            ];
            let otherGame = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            console.log(redPrizes, yellowPrizes, greenPrizes)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                colorDraftGame: 'active',
                otherGamesMenu: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                redPrizes: redPrizes,
                yellowPrizes: yellowPrizes,
                greenPrizes: greenPrizes,
                otherGame: otherGame,
                navigation: otherGame
            };
            return res.render('otherGames/colordraft', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editColordraftPostData: async function(req, res) {
        try {
            let colordraft = await Sys.App.Services.otherGameServices.getByData({ slug: 'colorDraft' });
            let prizeList = [
                {color: "red", amount: req.body.redColorPrize1},
                {color: "red", amount: req.body.redColorPrize2},
                {color: "red", amount: req.body.redColorPrize3},
                {color: "red", amount: req.body.redColorPrize4},
                {color: "yellow", amount: req.body.yellowColorPrize1},
                {color: "yellow", amount: req.body.yellowColorPrize2},
                {color: "yellow", amount: req.body.yellowColorPrize3},
                {color: "yellow", amount: req.body.yellowColorPrize4},
                {color: "green", amount: req.body.greenColorPrize1},
                {color: "green", amount: req.body.greenColorPrize2},
                {color: "green", amount: req.body.greenColorPrize3},
                {color: "green", amount: req.body.greenColorPrize4},
            ];
            

            if (colordraft == null) {
                await Sys.App.Services.otherGameServices.insertData({
                    colordraftPrizeList: prizeList,
                    slug: 'colorDraft'
                });
            } else {
                await Sys.App.Services.otherGameServices.updateData({ _id: colordraft._id }, {
                    colordraftPrizeList: prizeList
                })
            }

            req.flash('success', 'Color Draft Prizes updated successfully.');
            return res.redirect('/colorDraft')

        } catch (e) {
            console.log("Error", e);
        }
    },

}