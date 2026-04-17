var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');

module.exports = {
    security: async function(req,res){
        try {
            var data = {
                    App : Sys.Config.App.details,Agent : req.session.details,
                    error: req.flash("error"),
                    success: req.flash("success"),
                };
                return res.render('security/securityList',data);
        } catch (e) {
            console.log("Error",e);
        }
    },

    getSecurity: async function(req,res){
      try{
        let start = parseInt(req.query.start);
          let length = parseInt(req.query.length);
          let search = req.query.search.value;

          let query = {};
          if (search != '') {
            let capital = search;
            // query = {
              // or: [
                // {'username': { 'like': '%'+search+'%' }},
                // {'username': { 'like': '%'+capital+'%' }}
              //  ]
                // };
            query = { email: { $regex: '.*' + search + '.*' } };
          } else {
            query = { };
          }

          let chipsCount = await Sys.App.Services.ChipsHistoryServices.getChipsHistoryCount(query);
          //let chipsCount = chips.length;
          let data = await Sys.App.Services.ChipsHistoryServices.getChipsDatatable(query, length, start);

          var obj = {
            'draw': req.query.draw,
            'recordsTotal': chipsCount,
            'recordsFiltered': chipsCount,
            'data': data
          };
                res.send(obj);

      }catch (e){
        console.log("Error",e);
      }
    },

    blockedIp: async function(req, res){
      try {

        var data = {
          App : Sys.Config.App.details,Agent : req.session.details,
          error: req.flash("error"),
          success: req.flash("success"),
          blockedIpActive : 'active'
        };
        return res.render('security/blockedIP',data);
      } catch (e) {
        console.log("Error",e);
      }
    },

    addblockedIp: async function(req, res){
      try {

        var data = {
          App : Sys.Config.App.details,Agent : req.session.details,
          error: req.flash("error"),
          success: req.flash("success"),
        };
        return res.render('security/addBlockedIP',data);
      } catch (e) {
        console.log("Error",e);
      }
    },

    addblockedIpPostData:async function(req, res){
      try{
    
       await Sys.App.Services.blockedIpServices.insertIpData(
              {
                ip: req.body.ip,
                status: req.body.status,
                flag: req.body.flag,
              }
            )
            req.flash('success','Ip added into Blocked List');
            res.redirect("/blockedIp");

      }catch (e){
        console.log("Error",e);

      }
    },

    getBlockedIp: async function(req, res){
    try {
      let start = parseInt(req.query.start);
      let length = parseInt(req.query.length);
      let search = req.query.search.value;

      let query = {};
      if (search != '') {
        query = { ip: { $regex: '.*' + search + '.*' } };
        } else {
          query = { };
        }

        let ipCount = await Sys.App.Services.blockedIpServices.getIpCount(query);
        //let stacksCount = stacksC.length;
        let data = await Sys.App.Services.blockedIpServices.getIpDatatable(query, length, start);
        var obj = {
          'draw': req.query.draw,
          'recordsTotal': ipCount,
          'recordsFiltered': ipCount,
          'data': data
        };
        res.send(obj);
      } catch (e) {
        console.log("Error",e);
      }
    },

    editBlockedIp:async function(req,res){
      try{
      let blockedIp = await Sys.App.Services.blockedIpServices.getIpData({_id: req.params.id});
      var data = {
        App : Sys.Config.App.details,Agent : req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        agentActive : 'active',
        blockedIp: blockedIp,
      };
      return res.render('security/addBlockedIP',data);
      }catch(e){
        console.log("Error", e);
        return new Error("Error", e);
      }
    },

    editBlockedIpPostData: async function(req,res){
        try {
          let blockedIp = await Sys.App.Services.blockedIpServices.getIpData({_id: req.params.id});
          if (blockedIp) {

              await Sys.App.Services.blockedIpServices.updateIpData(
                {
                  _id: req.params.id
                },{
                    ip: req.body.ip,
                    status: req.body.status,
                    flag: req.body.flag,
                }
              )
              req.flash('success','Ip update successfully');
              res.redirect('/blockedIp');

          }else {
            req.flash('error', 'Stack not update successfully');
            res.redirect('/blockedIp/add');
            return;
          }
          // req.flash('success', 'Player Registered successfully');
          // res.redirect('/');
        } catch (e) {
            console.log("Error",e);
        }
    },

    deleteBlockedIp: async function(req, res){
        try {
            let blockedIp = await Sys.App.Services.blockedIpServices.getIpData({_id: req.body.id});
            if (blockedIp || blockedIp.length >0) {
              await Sys.App.Services.blockedIpServices.deleteIp(req.body.id)
              return res.send("success");
            }else {
              return res.send("error");
            }
          } catch (e) {
              console.log("Error",e);
          }
    }



}