let Sys = require('../../Boot/Sys');
let bcrypt = require('bcryptjs');
let parseInt = require('parse-int');
const {countryNames} = require('../../gamehelper/game1-process')
module.exports = {

    riskCountry: async function (req, res) {
        try {
            let viewFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Risk Country'] || [];
                let stringReplace =req.session.details.isPermission['Risk Country'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
            }
            let keys = [
                "risk_country_table",
                "dashboard",
                "risk_country",
                "search",
                "all",
                "inactive",
                "active",
                "reset",
                "risk_country_id",
                "risk_country_name",
                "add_risk_country",
                "action",
                "sr_no",
                "select_country",
                "delete_successfully",
                "delete_button",
                "cancel_button",
                "delete_message",
                "delete_player_message",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "deleted",
                "submit",
                "close"
            ]
            let riskCountryData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                riskCountryActive: 'active',
                riskCountryData: riskCountryData,
                navigation: riskCountryData
            };
            return res.render('riskCountry/riskCountry', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getCountryList: async function (req, res) {
        try {
            let countryList = countryNames.getCountries();
            let riskCountry = await Sys.App.Services.transactionServices.getRiskCountry();
            const riskCountryNames = new Set(riskCountry.map(country => country.countryName));

            // Filter out the countries that are in the riskCountry list
            const countriesList = countryList.filter(
            country => !riskCountryNames.has(country)
            );
            return res.send(countriesList);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getRiskCountry: async function (req, res) {
        try {
            console.log("getRiskCountry param", req.query.params);
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
                query = { $or: [{ countryName: { $regex: '.*' + search + '.*', $options: 'i' } }] }
            }
            let riskCountryCount = await Sys.App.Services.transactionServices.getRiskCountryCount(query);
            let data = await Sys.App.Services.transactionServices.getRiskCountryDatatable(query, length, start, sort);
            console.log("data", data);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': riskCountryCount,
                'recordsFiltered': riskCountryCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getRiskCountry controller:", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    addRiskCountry: async function (req, res) {
        try {
            console.log("addRiskCountry req.body", req.body);
            let data = await Sys.App.Services.transactionServices.addRiskCountry(req.body);
            return res.send(data);
        } catch (e) {
            console.log("Error in create risk country", e);
            req.flash('error', 'Internal Server Error');
            return res.redirect('/riskCountry');
        }
    },

    deleteRiskCountry: async function (req, res) {
        try {
            console.log("deleteRiskCountry coming here", req.query, req.params, req.body);
            let riskCountry = await Sys.App.Services.transactionServices.getSingleRiskCountryData({ _id: req.body.id });
            if (riskCountry) {
                await Sys.App.Services.transactionServices.deleteRiskCountry(riskCountry._id);
                return res.send("success");
            } else {
                return res.send("fail");
            }
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },
}
