var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');

module.exports = {
    walletView: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Wallet Management'] || [];
                let stringReplace =req.session.details.isPermission['Wallet Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Wallet Management'];

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            const keysArray = [
                "wallet_management_table",
                "dashboard",
                "wallet_management",
                "username",
                "emailId",
                "mobile_number",
                "wallet_amount",
                "firstname",
                "search",
                "customer_number",
                "withdraw_amount",
                "status",
                "action",
                "show",
                "entries",
                "previous",
                "next",
                "view_wallet"
            ];

            let walletData = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                walletActive: 'active',
                viewFlag: viewFlag,
                Wallet: walletData,
                navigation: walletData
            };
            return res.render('walletManagement/walletManagement', data);
        } catch (e) {
            console.log("Error walletView", e);
        }
    },

    getWallet: async function(req, res) {
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
                query.$or = [
                    { customerNumber: isNaN(Number(search) ) ? null : Number(search) },
                    { username: { $regex: '.*' + search + '.*' } } 
                ] 
                //query = { username: { $regex: '.*' + search + '.*' } };
            }

            if (req.session.details.role == 'agent') {
                query[`hall.id`] = req.session.details.hall[0].id;
                query['userType'] = { $ne: "Bot" }
            }
            let column = [
                '_id',
                'username',
                'email',
                'phone',
                'nickname',
                'walletAmount',
                'customerNumber'
            ]
            let reqCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);

            let data = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, column, start, length, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);

        } catch (e) {
            console.log("Error", e);
        }
    },

    viewUserWallet: async function(req, res) {
        try {
            let query = {
                _id: req.params.id
            };
            let dataWallet = await Sys.App.Services.PlayerServices.getById(query);
            
            const keysArray = [
                "wallet_management_table",
                "dashboard",
                "wallet_management",
                "username",
                "emailId",
                "mobile_number",
                "wallet_amount",
                "firstname",
                "view_wallet",
                "mobile_number"
            ];

            let walletData = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                walletActive: 'active',
                Wallet: dataWallet,
                WalletData: walletData,
                navigation: walletData
            };
            return res.render('walletManagement/viewWallet', data);
        } catch (e) {
            console.log("Error", e);
        }
    }
}