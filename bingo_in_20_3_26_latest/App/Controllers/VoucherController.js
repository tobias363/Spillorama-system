var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
module.exports = {
    voucherView: async function(req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Voucher Management'] || [];
                let stringReplace =req.session.details.isPermission['Voucher Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Voucher Management'];
                if (stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
            }
            let keys = [
                "voucher",
                "table",
                "add_voucher",
                "voucher_id",
                "voucher_type",
                "expiry_date",
                "points",
                "status",
                "action",
                "search_voucher_type",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "both_date_required",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_voucher",
                "delete_button",
                "cancel_button",
                "deleted",
                "cancelled",
                "voucher_deleted_successfully",
                "voucher_not_deleted",
                "view"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                VoucherActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                voucher: translate,
                navigation: translate

            };
            return res.render('VoucherManagement/voucher', data);
        } catch (e) {
            console.log("Error in voucherView", e);
            return new Error(e);
        }
    },

    getVoucher: async function(req, res) {

        // res.send(req.query.start); return false;
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
                query = { voucherType: { $regex: '.*' + search + '.*' } };
            }


            // let startTo = new Date(req.query.start_date);
            // let endFrom = new Date(req.query.end_date);
            // endFrom.setHours(23, 59, 59);

            // if (req.query.is_date_search == "yes" && search == '') {
            //     query = { createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            // if (req.query.is_date_search == "yes" && search != '') {
            //     query = { fullName: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            //console.log(query);
            let reqCount = await Sys.App.Services.VoucherServices.getCount(query);

            let data = await Sys.App.Services.VoucherServices.getDatatable(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            //console.log("data:::::::::::::", data)

            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addVoucher: async function(req, res) {
        try {
            let keys = [
                "voucher",
                "table",
                "add_voucher",
                "edit_voucher",
                "voucher_id",
                "voucher_type",
                "expiry_date_time",
                "percentage_off",
                "points",
                "status",
                "action",
                "cancel",
                "submit",
                "active",
                "inactive"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                voucherActive: 'active',
                voucherData: translate,
                navigation: translate

            };
            return res.render('VoucherManagement/voucherAdd', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addVoucherPostData: async function(req, res) {
        try {
            //console.log("addVoucherPostData", req.body);
            let keys = [
                "voucher_not_created",
                "voucher_created",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
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
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes;
                return dateTime; // Function returns the dateandtime
            }

            let voucher = await Sys.App.Services.VoucherServices.insertData({
                voucherId: createID + '_V',
                // voucherCode: Math.random().toString(36).toUpperCase().slice(-4) + "-" + Math.random().toString(36).toUpperCase().slice(-4) + "-" + Math.random().toString(36).toUpperCase().slice(-4) + "-" + Math.random().toString(36).toUpperCase().slice(-4),
                voucherType: req.body.voucherType,
                expiryDate: req.body.expiry_date,
                percentageOff: req.body.percentageOff,
                points: req.body.points,
                status: req.body.status
            });

            if (!voucher) {
                req.flash('error', translate.voucher_not_created);
                return res.redirect('/voucher');
            } else {
                req.flash('success', translate.voucher_created);
                return res.redirect('/voucher');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editVoucher: async function(req, res) {
        try {
            let keys = [
                "voucher",
                "table",
                "add_voucher",
                "edit_voucher",
                "voucher_id",
                "voucher_type",
                "expiry_date_time",
                "percentage_off",
                "points",
                "status",
                "action",
                "cancel",
                "submit",
                "active",
                "inactive"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let voucher = await Sys.App.Services.VoucherServices.getSingleData({ _id: req.params.id });


            var expiryDate = dateTimeFunction(voucher.expiryDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                voucherActive: 'active',
                voucher: voucher,
                ExpiryDate: expiryDate,
                voucherData: translate,
                navigation: translate
            };
            return res.render('VoucherManagement/voucherAdd', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editVoucherPostData: async function(req, res) {
        try {
            //console.log("editVoucherPostData", req.body);
            let keys = [
                "voucher_updated",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let voucher = await Sys.App.Services.VoucherServices.getSingleData({ _id: req.params.id });

            if (!voucher) {
                req.flash('error', 'No Voucher found');
                return res.redirect('/voucher');
            }


            let data = {
                voucherType: req.body.voucherType,
                expiryDate: req.body.expiry_date,
                percentageOff: req.body.percentageOff,
                points: req.body.points,
                status: req.body.status
            }

            await Sys.App.Services.VoucherServices.updateData({ _id: req.params.id }, data)

            req.flash('success', translate.voucher_updated);
            return res.redirect('/voucher');

        } catch (e) {
            console.log("Error", e);
        }
    },


    getVoucherDelete: async function(req, res) {
        try {
            let player = await Sys.App.Services.VoucherServices.getSingleData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.VoucherServices.delete(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewVoucher: async function(req, res) {
        try {
            let keys = [
                "voucher",
                "view_voucher",
                "table",
                "add_voucher",
                "edit_voucher",
                "voucher_id",
                "voucher_type",
                "expiry_date_time",
                "percentage_off",
                "points",
                "status",
                "action",
                "cancel",
                "submit",
                "active",
                "inactive"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let query = {
                _id: req.params.id
            };
            let voucher = await Sys.App.Services.VoucherServices.getById(query);

            var expiryDate = dateTimeFunction(voucher.expiryDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                voucherActive: 'active',
                voucher: voucher,
                ExpiryDate: expiryDate,
                voucherData: translate,
                navigation: translate
            };
            return res.render('VoucherManagement/voucherView', data);
        } catch (e) {
            console.log("Error", e);
        }
    }

}