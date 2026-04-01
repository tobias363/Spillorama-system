var Sys = require('../../Boot/Sys');
// var bcrypt = require('bcryptjs');
// var currentDate = new Date();
// var md5 = require('md5');

const moduleTranslations = [
    { english: 'Players Management', norwegian: 'Spilleradministrasjon' },
    { english: 'Schedule Management', norwegian: 'Tidsplanadministrasjon' },
    { english: 'Games Management', norwegian: 'Spilladministrasjon' },
    { english: 'Save Game List', norwegian: 'Lagret spillliste' },
    { english: 'Physical Ticket Management', norwegian: 'Administrasjon av fysiske billetter' },
    { english: 'Unique ID Modules', norwegian: 'Unike ID-moduler' },
    { english: 'Report Management', norwegian: 'Rapportadministrasjon' },
    { english: 'Hall Account Report', norwegian: 'Hallkonto-rapport' },
    { english: 'Hall Account Specific Report', norwegian: 'Hall-kontospecifikk rapport' },
    { english: 'Wallet Management', norwegian: 'Lommebokadministrasjon' },
    { english: 'Transactions Management', norwegian: 'Transaksjonsadministrasjon' },
    { english: 'Withdraw Management', norwegian: 'Uttaksadministrasjon' },
    { english: 'Payout Management', norwegian: 'Utbetalingsadministrasjon' },
    { english: 'Product Management', norwegian: 'Produktadministrasjon' },
    { english: 'Accounting', norwegian: 'Regnskap' },
    { english: 'System Information', norwegian: 'Systeminformasjon' }
];

const modules = moduleTranslations.map(item => item.english);

var permissions = ["view", "add", "edit", "delete", "start", "pause", "block/unblock", "accept", "reject", "withdraw_username_uniqueId", "view_risk_category", "edit_risk_category", "view_risk_comment", "edit_risk_comment"];

module.exports = {
    view: async function(req, res) {
        let addFlag = true;
        let editFlag = true;
        let viewFlag = true;
        let deleteFlag = true;
        if(!req.session.details.isSuperAdmin){
            // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
            // if (user == null || user.length == 0) {
            //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
            // }
            // let stringReplace = user.permission['Role Management'] || [];
            let stringReplace =req.session.details.isPermission['Role Management'] || [];
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
            if (stringReplace?.indexOf("add") == -1) {
                addFlag = false;
            }
        }
        const keysArray = [
            "role_management_table",
            "role_management",
            "sr_no",
            "username",
            "action",
            "add_agent_for_assign_role",
            "view_product",
            "edit_product",
            "delete_message",
            "delete_button",
            "cancel_button",
            "something_went_wrong",
            "cancelled",
            "deleted",
            "failed",
            "active", 
            "inactive",
            "dashboard",
            "search",
            "start_date",
            "end_date",
            "show",
            "entries",
            "previous",
            "next",
            "submit",
            "action",
            "status",
            "cancel",
            "system_information"
        ]
              
        let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
        var data = {
            App: Sys.Config.App.details,
            Agent: req.session.details,
            error: req.flash("error"),
            success: req.flash("success"),
            rollActive: 'active',
            roleActive: 'active',
            viewFlag: viewFlag,
            editFlag: editFlag,
            deleteFlag: deleteFlag,
            addFlag: addFlag,
            roles: lanTransaltion,
            navigation: lanTransaltion
        };
        return res.render('role/list', data);
    },

    getRole: async function(req, res) {
        try {
            //console.log("req.query", req.query);
            let isIndividual = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // let stringReplace = user.permission['Role Management'] || [];
                let stringReplace =req.session.details.isPermission['Role Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("role_all_agent_allow") == -1) {
                    isIndividual = false;
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let query = { isAssginRole: true };
            if (search) {
                query = { agentName: { $regex: '.*' + search + '.*', $options: 'i' }, isAssginRole: true };
            }
            if(!isIndividual){
                query.parentId = req.session.details.id;
            }
            let reqCount = await Sys.App.Services.RoleServices.getCount(query);

            let data = await Sys.App.Services.RoleServices.getDatatable(query, length, start)

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data, //data
            };

            res.send(obj);
        } catch (error) {
            console.log("Error getRole", error);
        }

    },

    add: async function(req, res) {
        try {

            let datasRole = await Sys.App.Services.RoleServices.getByData({ isAssginRole: true })

            let agent = await Sys.App.Services.AgentServices.getByDataForRole({}, ['_id', 'name', 'agentId']);

            const keysArray = [
                "assign_role_to_agent",
                "role_management",
                "agent",
                "dashboard",
                "module_name",
                "role_management_table",
                "add_agent_for_assign_role",
                "assign_role_to_agent",
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
                "role_withdraw_uname",
                "add_roll",
                "cancel",
                "role_view_risk_category",
                "role_edit_risk_category",
                "role_view_risk_comment",
                "role_edit_risk_comment",
            ]
                  
            let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            
            // if(req.session.details.language == "norwegian"){
            //     modules = [
            //         'Spilleradministrasjon',
            //         'Tidsplanadministrasjon',
            //         'Spilladministrasjon',
            //         'Lagret spilllistet',
            //         'Administrasjon av fysiske billetter',
            //         'Unike ID-moduler',
            //         'Rapportadministrasjon',
            //         'Hall Account Report',
            //         'Hall-kontospesifikk rapport',
            //         'Lommebokadministrasjon',
            //         'Transaksjonsadministrasjon',
            //         'Uttaksadministrasjon',
            //         'Utbetalingsadministrasjon',
            //         'Produktadministrasjon',
            //         'Regnskap'
            //     ];
            // }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                rollActive: 'active',
                modules: modules,
                moduleTranslations,
                permissions: permissions,
                user: agent,
                disabledOptionField: datasRole,
                roles: lanTransaltion,
                navigation: lanTransaltion,
                language: req.session.details.language, // "english" or "norwegian"
            };
            return res.render('role/add', data);
        } catch (error) {
            console.log("role >> add :::::::::::>>>> error: ", error);
            req.flash('error', "Role under maintenance.");
            res.redirect('/role');
        }
    },

    save: async function(req, res) {
        try {
            let translation = await Sys.Helper.bingo.getTraslateData(["role_added_success", "role_not_added"], req.session.details.language);
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

            let userId = req.body.userId;
            let prId = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: userId });

            var inputData = {
                agentId: userId,
                agentName: prId.name,
                parentId: prId.parentId,
                permission: permObj,
                agnetIdNormal: prId.agentId,
                isAssginRole: true
            };

            console.log("inputData", inputData);

            let RoleData = await Sys.App.Services.RoleServices.insertData(inputData);

            await Sys.App.Services.AgentServices.FindOneUpdate({ _id: userId }, { roleId: RoleData._id });
            req.flash('success', translation.role_added_success);
            res.redirect('/role');
        } catch (error) {
            console.log("role >> save:::::::::::::::>>> error: ", error);
            req.flash('error', "Role detail not save.");
            res.redirect('/role');
        }
    },

    edit: async function(req, res) {
        try {
            let roleId = req.params.id;
            if (roleId != "" && roleId != 0) {
                let roleDetail = await Sys.App.Services.RoleServices.getById(roleId);
                //roleDetail.userId = roleDetail.userId.toString();
                let agent = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: roleDetail.agentId });
                if (roleDetail != null) {
                    const keysArray = [
                        "assign_role_to_agent",
                        "role_management",
                        "edit_assign_role_for_agent",
                        "agent",
                        "dashboard",
                        "module_name",
                        "role_management_table",
                        "add_agent_for_assign_role",
                        "assign_role_to_agent",
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
                        Agent: req.session.details,
                        error: req.flash("error"),
                        success: req.flash("success"),
                        rollActive: 'active',
                        role: roleDetail,
                        modules: modules,
                        moduleTranslations,
                        permissions: permissions,
                        agentData: agent,
                        roles: lanTransaltion,
                        navigation: lanTransaltion,
                        language: req.session.details.language, // "english" or "norwegian"
                    }
                    return res.render('role/newEdit', data);
                } else {
                    let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
                    req.flash('error', translate.role_detail_not_available);
                    // req.flash('error', "Role detail not available.");
                    res.redirect('/role');
                }
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
                req.flash('error', translate.role_detail_not_available);
                res.redirect('/role');
            }
        } catch (error) {
            console.log("role >> edit ::::::::::::::>> error: ", error);
            let translate = await Sys.Helper.bingo.getTraslateData(['role_detail_not_available'], req.session.details.language)
            req.flash('error', translate.role_detail_not_available);
            res.redirect('/role');
        }
    },

    update: async function(req, res) {
        try {
            let translation = await Sys.Helper.bingo.getTraslateData(["role_updated", "role_not_updated"], req.session.details.language);
            let roleId = req.params.id;
            console.log("🚀 ~ update:function ~ roleId:", roleId)
            if (roleId != "" && roleId != 0) {
                let roleData = await Sys.App.Services.RoleServices.getById(roleId);
                console.log("🚀 ~ update:function ~ roleData:", roleData)
                if (roleData) {
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

                    let updatedData = await Sys.App.Services.RoleServices.updateData({ _id: roleData._id }, { permission: permObj })
                    console.log("updatedData", updatedData);

                    req.flash('success', translation.role_updated);
                    res.redirect('/role');
                } else {
                    req.flash('error', translation.role_not_updated);
                    res.redirect('/role');
                }
            } else {
                req.flash('error',  translation.role_not_updated);
                res.redirect('/role');
            }
        } catch (error) {
            console.log("role >> update::::::::::::::>>error: ", error);
            req.flash('error', "Role detail not update.");
            res.redirect('/role');
        }
    },

    delete: async function(req, res) {
        try {
            let translation = await Sys.Helper.bingo.getTraslateData(["role_deleted", "role_not_deleted"], req.session.details.language);
            var roleId = req.params.id;
            if (roleId != "" && roleId != 0) {

                var userData = await Sys.App.Services.RoleServices.deleteRole(roleId);

                req.flash('success', translation.role_deleted);
                res.redirect('/role');
            } else {
                req.flash('error', translation.role_not_deleted);
                res.redirect('/role');
            }
        } catch (err) {
            console.log('role >> delete:::::::::::>>>>> error: ', error);
            req.flash('error', "Role not delete.");
            res.redirect('/role');
        }
    },

    checkDuplicate: async function(req, res) {
        try {
            var name = req.body.name;
            let condition = { is_deleted: '0' };

            if (name) {
                condition.name = name;
            }

            if (req.body.id) {
                condition._id = { $ne: req.body.id };
            }
            var roleData = await model.Role.findOne(condition);
            if (roleData) {
                res.send("false");
            } else {
                res.send("true");
            }
        } catch (err) {
            console.log("checkDuplicate::::::::::::>>>Error: ", err)
            res.send('false');
        }
    },
}