const Sys = require('../../Boot/Sys');
const bcrypt = require('bcryptjs');
const parseInt = require('parse-int');
const moduleTranslations = [
    { english: 'Players Management', norwegian: 'Spilleradministrasjon' },
    { english: 'Tracking Player Spending', norwegian: 'Spore spillerforbruk' },
    { english: 'Game Type', norwegian: 'Spilltype' },
    { english: 'Schedule Management', norwegian: 'Tidsplanadministrasjon' },
    { english: 'Games Management', norwegian: 'Spilladministrasjon' },
    { english: 'Save Game List', norwegian: 'Lagret spilliste' },
    { english: 'Other Games', norwegian: 'Andre spill' },
    { english: 'Physical Ticket Management', norwegian: 'Administrasjon av fysiske billetter' },
    { english: 'Unique ID Modules', norwegian: 'Unike ID-moduler' },
    { english: 'Other Modules', norwegian: 'Andre moduler' },
    { english: 'Pattern Management', norwegian: 'Mønsterbehandling' },
    { english: 'Agent Management', norwegian: 'Agentadministrasjon' },
    { english: 'Hall Management', norwegian: 'Hallledelse' },
    { english: 'Group Of Halls Management', norwegian: 'Gruppe av halladministrasjon' },
    { english: 'Product Management', norwegian: 'Produktledelse' },
    { english: 'Role Management', norwegian: 'Rolleledelse' },
    { english: 'Report Management', norwegian: 'Rapporthåndtering' },
    { english: 'Payout Management', norwegian: 'Utbetalingshåndtering' },
    { english: 'Risk Country', norwegian: 'Risikoland' },
    { english: 'Hall Account Report', norwegian: 'Hallkontorapport' },
    { english: 'Wallet Management', norwegian: 'Lommebokadministrasjon' },
    { english: 'Transactions Management', norwegian: 'Transaksjonsadministrasjon' },
    { english: 'Withdraw Management', norwegian: 'Uttaksadministrasjon' },
    { english: 'Leaderboard Management', norwegian: 'Ledelse av ledertavler' },
    { english: 'Voucher Management', norwegian: 'Kuponghåndtering' },
    { english: 'Loyalty Management', norwegian: 'Lojalitetsstyring' },
    { english: 'SMS Advertisement', norwegian: 'SMS-annonse' },
    { english: 'CMS Management', norwegian: 'CMS-administrasjon' },
    { english: 'Settings', norwegian: 'Innstillinger' },
    { english: 'System Information', norwegian: 'Systeminformasjon' },
    { english: 'Hall Account Specific Report', norwegian: 'Hall-kontospesifikk rapport' },
    // { english: 'Accounting', norwegian: 'Regnskap' },
    // { english: 'Cash In/Out Management', norwegian: 'Kontant inn/ut-administrasjon' },
];
const modules = moduleTranslations.map(item => item.english);

let permissions = ["view", "add", "edit", "delete", "start", "pause", "block/unblock", "accept", "reject", "role_all_agent_allow", "withdraw_username_uniqueId", "view_risk_category", "edit_risk_category", "view_risk_comment", "edit_risk_comment"];
module.exports = {

    admin: async function (req, res) {
        try {
            let keys = [
                "sub_admin",
                "dashboard",
                "admin",
                "search",
                "all",
                "inactive",
                "active",
                "reset",
                "admins",
                "add_admin",
                "admin_id",
                "admin_name",
                "emailId",
                "mobile_number",
                "hall_name",
                "status",
                "action",
                "admin_name_or_email",
                "admin_not_delete",
                "admin_delete_msg",
                "delete_cencel",
                "delete_title_message",
                "delete_admin_message",
                "delete_successfully",
                "delete_button",
                "cancel_button",
                "delete_message",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "deleted",
                "no_hall_assigned"
            ]
            let adminData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                adminActive: 'active',
                adminData: adminData,
                navigation: adminData
            };
            return res.render('admin/admins', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getAdmin: async function (req, res) {
        try {
            console.log("get admin param", req.query.params);
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
            let query = {isSuperAdmin:false};
            if (search != '') {
                query = { $or: [{ name: { $regex: '.*' + search + '.*', $options: 'i' } }, { email: { $regex: '.*' + search + '.*', $options: 'i' } }], isSuperAdmin:false }
            }
            let playersCount = await Sys.App.Services.AdminServices.getAdminCount(query);
            let data = await Sys.App.Services.AdminServices.getAdminDatatable(query, length, start, sort);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getAdmin controller:", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    addAdmin: async function (req, res) {
        try {
            let keys = [
                "admin_table",
                "dashboard",
                "admin",
                "edit_admin",
                "add_admin",
                "admin_name",
                "emailId",
                "phone_number",
                "assigned",
                "new_password",
                "confirm_password",
                "password",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "assign"
            ]

            let adminData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                adminActive: 'active',
                adminData: adminData,
                navigation: adminData
            };
            return res.render('admin/add', data);
        } catch (e) {
            console.log("Error in addAdmin page", e);
        }
    },

    addAdminPostData: async function (req, res) {
        try {
            console.log("req.body", req.body);
            let admin = await Sys.App.Services.AdminServices.getByData({ email: req.body.email });
            if (admin.length) {
                let translate = await Sys.Helper.bingo.getTraslateData(['admin_already_exists'], req.session.details.language)
                req.flash('error',translate.admin_already_exists )//'Admin Already Exists');
                return res.redirect('/adminUser');
            }
            let permission = {
                "Players Management": [
                  "view",
                  "add",
                  "edit",
                  "delete",
                  "block/unblock",
                  "withdraw_username_uniqueId",
                  "view_risk_category",
                  "edit_risk_category",
                  "view_risk_comment",
                  "edit_risk_comment"
                ],
                "Tracking Player Spending": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Game Type": [
                  "view",
                  "edit",
                ],
                "Schedule Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Games Management": [
                  "view",
                  "add",
                  "edit",
                  "delete",
                  "start",
                  "pause"
                ],
                "Save Game List": [
                  "view",
                  "edit",
                  "delete"
                ],
                "Other Games": [
                  "view",
                  "edit",
                  "delete"
                ],
                "Physical Ticket Management": [
                  "view",
                  "add"
                ],
                "Unique ID Modules": [
                  "view",
                  "add",
                  "withdraw_username_uniqueId"
                ],
                "Other Modules": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Pattern Management": [
                  "view",
                ],
                "Agent Management": [
                  "view",
                  "add",
                  "edit",
                  "delete",
                  "role_all_agent_allow"
                ],
                "Hall Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Group Of Halls Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Product Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Role Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Report Management": [
                  "view"
                ],
                "Payout Management": [
                  "view"
                ],
                "Risk Country": [
                  "view",
                  "add",
                  "delete"
                ],
                "Hall Account Report": [
                  "view",
                  "edit"
                ],
                "Wallet Management": [
                  "view"
                ],
                "Transactions Management": [
                  "view",
                  "accept",
                  "reject"
                ],
                "Withdraw Management": [
                  "view",
                  "accept",
                  "reject"
                ],
                "Leaderboard Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Voucher Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "Loyalty Management": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "SMS Advertisement": [
                  "view",
                  "add",
                  "edit",
                  "delete"
                ],
                "CMS Management": [
                  "view",
                  "add",
                  "edit",
                ],
                "Settings": [
                  "view",
                  "edit"
                ],
                "System Information": [
                  "view",
                  "edit"
                ],
                "Hall Account Specific Report": [
                  "view"
                ]
              }
            let pass = bcrypt.hashSync(req.body.newpassword, bcrypt.genSaltSync(8), null);
            admin = await Sys.App.Services.AdminServices.insertAdminData({
                name: req.body.name,
                email: req.body.email,
                role: 'admin',
                password: pass,
                permission:permission,
                status: req.body.status
            });
            console.log("admin is", admin);
            if (!admin) {
                let translate = await Sys.Helper.bingo.getTraslateData(['admin_not_creates'], req.session.details.language)
                req.flash('error',translate.admin_not_creates )// 'Admin Not Created');
                return res.redirect('/adminUser');
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['admin_create_successfully'], req.session.details.language)
                req.flash('success',translate.admin_create_successfully )// 'Admin create successfully');
                return res.redirect('/adminUser');
            }

        } catch (e) {
            console.log("Error in create admin", e);
            let translate = await Sys.Helper.bingo.getTraslateData(['internal_server_error'], req.session.details.language)
            req.flash('error', translate.internal_server_error )// 'Internal Server Error');
            return res.redirect('/adminUser');
        }
    },

    editAdmin: async function (req, res) {
        try {

            let admin = await Sys.App.Services.AdminServices.getSingleAdminData({ _id: req.params.id });

            let keys = [
                "admin_table",
                "dashboard",
                "admin",
                "edit_admin",
                "add_admin",
                "admin_name",
                "emailId",
                "phone_number",
                "assigned",
                "new_password",
                "confirm_password",
                "password",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "assign"
            ]

            let adminData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)


            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                adminActive: 'active',
                admin: admin,
                adminData: adminData,
                navigation: adminData
            };

            req.session.playerBack = req.header('Referer');
            return res.render('admin/add', data);
        } catch (e) {
            console.log("Error in editAdmin Page::", e);
        }
    },


    editAdminPostData: async function (req, res) {
        try {
            console.log("change: ", req.body);
            let admin = await Sys.App.Services.AdminServices.getSingleAdminData({ _id: req.params.id });
            if (admin) {
                let duplicateAdmin = await Sys.App.Services.AdminServices.getSingleAdminData({ _id:{$ne: req.params.id},$or:[{name:req.body.name},{email:req.body.email}]});
                if(duplicateAdmin){
                    let translate = await Sys.Helper.bingo.getTraslateData(['admin_already_exists'], req.session.details.language)
                    req.flash('error',translate.admin_already_exists )//'Admin Already Exists');
                    return res.redirect('/adminUser');
                }
                let data = {
                    name: req.body.name,
                    email: req.body.email,
                    status: req.body.status
                }
                if (req.body.newpassword) {
                    let pass = bcrypt.hashSync(req.body.newpassword, bcrypt.genSaltSync(8), null);
                    data.password = pass;
                }
                console.log("data", data);
                await Sys.App.Services.AdminServices.updateAdminData({ _id: req.params.id }, data)
                
                let translate = await Sys.Helper.bingo.getSingleTraslateData(["admin_updated_successfully"], req.session.details.language)
                req.flash('success',translate )//'Admin updated successfully');
                return res.redirect(req.session.playerBack);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(["user_not_found"], req.session.details.language)
                req.flash('error', translate.user_not_found)//'No User found');
                return res.redirect(req.session.playerBack);
            }
        } catch (e) {
            console.log("Error", e);
        }
    },


    getAdminDelete: async function (req, res) {
        try {
            console.log("getAdminDelete call:", req.body);
            let admin = await Sys.App.Services.AdminServices.getSingleAdminData({ _id: req.body.id });
            if (admin || admin.length > 0) {
                await Sys.App.Services.AdminServices.deleteAdmin(admin._id);
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },

    editRole: async function(req, res) {
        try {
            let adminId = req.params.id;
            if (adminId != "" && adminId != 0) {
                let admin = await Sys.App.Services.AdminServices.getById(adminId);
                console.log('admin',JSON.stringify(admin,null,2));
                if (admin != null) {
                    const keysArray = [
                        "assign_role_to_admin",
                        "role_management",
                        "edit_assign_role_for_admin",
                        "admin_name",
                        "dashboard",
                        "module_name",
                        "role_management_table",
                        "add_agent_for_assign_role",
                        "assign_role_to_admin",
                        "module_name",
                        "role_title",
                        "role_add",
                        "role_edit",
                        "role_delete",
                        "role_start",
                        "role_pause",
                        "role_block_unblock",
                        "role_accept",
                        "role_reject",
                        "role_all_agent_allow",
                        "role_withdraw_uname",
                        "add_roll",
                        "cancel",
                        "update_role_detail",
                        "role_view_risk_category",
                        "role_edit_risk_category",
                        "role_view_risk_comment",
                        "role_edit_risk_comment",
                    ]
                          
                    let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
                    
                    let data = {
                        App: Sys.Config.App.details,
                        Admin: req.session.details,
                        error: req.flash("error"),
                        success: req.flash("success"),
                        adminActive: 'active',
                        modules: modules,
                        moduleTranslations,
                        language: req.session.details.language,
                        permissions: permissions,
                        adminData: admin,
                        roles: lanTransaltion,
                        navigation: lanTransaltion
                    }

                    return res.render('admin/editRole', data);
                } else {
                    let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
                    req.flash('error', translate.role_detail_not_available )// "Role detail not available.");
                    res.redirect('/adminUser');
                }
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
                req.flash('error', translate.role_detail_not_available )// "Role detail not available.");
                res.redirect('/adminUser');
            }
        } catch (error) {
            console.log("role >> edit ::::::::::::::>> error: ", error);
            let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
            req.flash('error', translate.role_detail_not_available )// "Role detail not available.");
            res.redirect('/adminUser');
        }
    },

    updateRole: async function(req, res) {
        try {
            let translation = await Sys.Helper.bingo.getTraslateData(["role_updated", "role_not_updated"], req.session.details.language);
            let adminId = req.params.id;
            console.log("🚀 ~ update:function ~ adminId:", adminId)
            if (adminId != "" && adminId != 0) {
                let adminData = await Sys.App.Services.AdminServices.getById(adminId);
                console.log("🚀 ~ update:function ~ adminData:", adminData)
                if (adminData) {
                    let input = req.body;
                    let permObj = {};

                    modules.forEach(function(moduleName) {
                        permissions.forEach(function(permission) {
                            if (input[moduleName + permission]) {
                                if (!permObj[moduleName]) {
                                    permObj[moduleName] = [];
                                }
                                permObj[moduleName].push(permission);
                            }
                        });
                    });

                    let updatedData = await Sys.App.Services.AdminServices.updateAdminData({ _id: adminId }, { permission: permObj })
                    console.log("updatedData", updatedData);

                    req.flash('success', translation.role_updated);
                    res.redirect(`/editRole/${req.params.id}`);
                } else {
                    req.flash('error', translation.role_not_updated);
                    res.redirect(`/editRole/${req.params.id}`);
                }
            } else {
                req.flash('error',  translation.role_not_updated);
                res.redirect(`/editRole/${req.params.id}`);
            }
        } catch (error) {
            console.log("role >> update::::::::::::::>>error: ", error);
            req.flash('error', "Role detail not update.");
            res.redirect(`/editRole/${req.params.id}`);
        }
    },

}
