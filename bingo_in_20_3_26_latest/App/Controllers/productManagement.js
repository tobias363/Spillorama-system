const { default: mongoose } = require('mongoose');
var Sys = require('../../Boot/Sys');
const fs = require('fs');

module.exports = {

  // Product

  productListPage: async function (req, res) {
    try {

      let editFlag = true;
      let deleteFlag = true;
      let addFlag = true;
      let viewFlag = true;

      if(!req.session.details.isSuperAdmin){
        // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
        // if (user == null || user.length == 0) {
        //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
        // }
        // let stringReplace = user.permission['Product Management'] || [];
        let stringReplace =req.session.details.isPermission['Product Management'] || [];
        if(!stringReplace.length){
            let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
            req.flash('error',translate.no_permission )//'you_have_no_permission';
            return res.redirect('/dashboard');
        }
        // var stringReplace = req.session.details.isPermission['Product Management'];

        if (!stringReplace || stringReplace.indexOf("edit") == -1) {
          editFlag = false;
        }
        if (!stringReplace || stringReplace.indexOf("delete") == -1) {
          deleteFlag = false;
        }
        if (!stringReplace || stringReplace.indexOf("add") == -1) {
          addFlag = false;
        }

        if (!stringReplace || stringReplace.indexOf("view") == -1) {
          viewFlag = false;
        }

      }

      const keysArray = [
        "product_management",
        "add_product",
        "product_name",
        "price",
        "select_category",
        "image",
        "category",
        "search_product_name",
        "product_id",
        "view_product",
        "edit_product",
        "delete_message",
        "delete_button",
        "cancel_button",
        "product_has_been_deleted",
        "something_went_wrong",
        "cancelled_delete_product",
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
        "cancel"
      ]
          
      let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

      var data = {
        App: Sys.Config.App.details,
        Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        productManagement: 'active',
        productList: 'active',
        editFlag: editFlag,
        deleteFlag: deleteFlag,
        addFlag: addFlag,
        viewFlag: viewFlag,
        products: lanTransaltion,
        navigation: lanTransaltion
      };


      if (viewFlag == true) {
        return res.render('Products/product-list', data);
      } else {
        req.flash('error', 'You are Not allowed to access that page.');
        return res.redirect('/dashboard');
      }

    } catch (e) {
      console.log("Error in productList Page", e);
      return new Error(e);
    }
  },

  getProducts: async function (req, res) {
    try {
      console.log("Products Request ::::", req.query);
      let order = req.query.order;
      let params = req.query.params;
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
      let query = {}
      if (search) {
        query = { name: { $regex: '.*' + search + '.*', $options: 'i' } };
      }

      if (req.session.details.role == "agent") {
        let agents = await Sys.App.Services.AgentServices.getByData({
          "hall" : 
          {
            $elemMatch: { 'id': req.session.details.hall[0].id }}
        })
        agents = agents.map(a=>a._id);
        query['$or'] = [{"adminProduct":true},{"createdBy" : {"$in" :agents}}]
      }
      let productCount = await Sys.App.Services.ProductServices.getProductCount(query);
      console.log("final query", JSON.stringify(query));
      let opt = { _id: 0, name: 1 };
      // let data = await Sys.App.Services.ProductServices.getProductDatatable(query, length, start, sort,opt);
      let data = await Sys.App.Services.ProductServices.getByData(query, length, start, sort, opt);
      console.log("data of products",data);
      var obj = {
        'draw': req.query.draw,
        'recordsTotal': productCount,
        'recordsFiltered': productCount,
        'data': data
      };
      return res.send(obj);
    } catch (e) {
      console.log("Error", e);
      return res.send({
        'status': 500,
        'message': 'Server Side Error, Try Again after Sometime.',
        'draw': req.query.draw,
        'recordsTotal': 0,
        'recordsFiltered': 0,
        'data': []
      });
    }
  },

  getProduct: async function (req, res) {
    try {
      console.log("Products Request ::::", req.params);
      let query = req.params;
      let opt = {
        _id : 1,
        name:1
      }
      let data = await Sys.App.Services.ProductServices.getByData({"_id":query.id},null,null,null,opt);
      console.log("This is Product",data);
      let obj = {};
      if (data.length) {
        obj = {
          //  "status": 200,
          "status": "success",
          "message": "Product Found.",
          "data": {
            id: data[0]._id,
            name: data[0].name,
            price:data[0].price,
            category:data[0].category,
            status:data[0].status,
            productImage:data[0].productImage
          }
        };
      }else{
        obj = {
          //  "status": 200,
          "status": "fail",
          "message": "Product Not Found.",
          "data": null
        };
      }
      return res.send(obj);
    } catch (e) {
      console.log("Error", e);
      return res.send({
        'status': 500,
        'message': 'Server Side Error, Try Again after Sometime.',
        'data': null
      });
    }
  },

  addProduct: async function (req, res) {
    try {
      console.log("requested appProduct", req.body,req.files);
      let productName = req.body.name.trim();
      console.log('productName',productName);
      if(!productName.length){
        req.flash("error", await Sys.Helper.bingo.getTraslateData(["please_enter_product_name"], req.session.details.language)) //"Please enter product name!");
        return res.send({
          status: "fail",
          message: "Please enter product name!"
        });
      }
      let product = await Sys.App.Services.ProductServices.getByData({ "name": productName });
      console.log("product find result", product);

      let translations = await Sys.Helper.bingo.getTraslateData(["product_name_exists", "product_not_added_image_validation", "product_created"], req.session.details.language);
      
      if (product.length !== 0) {
        req.flash("error", translations.product_name_exists)
        return res.send({
          status: "fail",
          message: "Product Name Already Exist!"
        });
      }
      let imagePath = '';
      if (req.files) {
        let image = req.files.productImage;
        console.log(image);
        var re = /(?:\.([^.]+))?$/;
        let imageName = image.name.split('.')[0];
        var extension = re.exec(image.name)[1];
        let extentionArray = ['jpg','jpeg','png'];
        if (!extentionArray.includes(extension.toLowerCase())) {
          req.flash("error", translations.product_not_added_image_validation)
          return res.send({
            status: "fail",
            message: "Only JPG,JPEG and PNG files are allowed!"
          });
        }
        let randomNum = Math.floor(100000 + Math.random() * 900000);
        let fileName = imageName + '_' + randomNum + '.' + extension;
        let path = 'public/assets/product/'
        // Use the mv() method to place the file somewhere on your server
        if (fs.existsSync(path)) {
          image.mv( path + fileName, function (err) {
              if (err) {
                  console.log("error during upload image 0",err);
                  req.flash('error', 'Error Uploading Profile Avatar');
                  return res.send({
                    status: "fail",
                    message: "Error Uploading Profile Avatar"
                  });
              }
          });
        }else{
          //create folder if doesn't exist
          fs.mkdirSync(path, { recursive: true });
          image.mv(path + fileName, function (err) {
            if (err) {
              console.log("error during upload image 1", err);
              req.flash('error', 'Error Uploading Profile Avatar');
              return res.send({
                status: "fail",
                message: "Error Uploading Profile Avatar"
              });
            }
          });
        }
        imagePath = '/assets/product/' + fileName;
      }else{
        req.flash("error",await Sys.Helper.bingo.getTraslateData(["game_name_already_exists"], req.session.details.language)) //"Please select your product image")
        return res.send({
          status: "fail",
          message: "Please select your product image"
        });
      }
      
      let data = {
        name: productName,
        price: req.body.price,
        category: req.body.category,
        productImage: imagePath,
        status: req.body.status,
        createdBy: mongoose.Types.ObjectId(req.session.details.id),
        adminProduct: (req.session.details.role == "admin") ? true : false,
      }
      let response = await Sys.App.Services.ProductServices.insertProductData(data);
      if (!response || response instanceof Error) {
        req.flash("error",await Sys.Helper.bingo.getTraslateData(["product_was_not_added"], req.session.details.language)) //"Product Was Not Added")
        return res.send({
          status: "fail",
          message: "Product not Added!"
        });
      }
      console.log("Product Response", response);
      req.flash("success", translations.product_created)
      return res.send({
        status: "success",
        message: "Product Created Successfully!"
      });
    } catch (error) {
      console.log("Error in add Product Controller", error);
      req.flash("error",await Sys.Helper.bingo.getTraslateData(["product_was_not_added"], req.session.details.language)) //"Product Was Not Added")
      return res.send({
        status: "fail",
        message: "Product not Added!"
      });
    }
  },

  editProduct: async function (req, res) {
    try {
      console.log("requested editProduct", req.body,req.files);
      let product = await Sys.App.Services.ProductServices.getByData({ "_id": req.body.productId });
      console.log("product find result", product);

      let translations = await Sys.Helper.bingo.getTraslateData(["product_not_exists", "enter_product_name", "product_name_exixts_update", "product_not_added_image_validation_update", "error_uploading_image", "product_update_failed", "product_updated"], req.session.details.language);

      if (product.length == 0) {
        req.flash("error", translations.product_not_exists);
        return res.send({
          status: "fail",
          message: "Product Does Not Exist!"
        });
      }
      let productName = req.body.name.trim();
      console.log('productName',productName);
      if(!productName.length){
        req.flash("error", translations.enter_product_name);
        return res.send({
          status: "fail",
          message: "Please enter product name!"
        });
      }
      let productNameExist = await Sys.App.Services.ProductServices.getFindOneByData({ "_id": {$ne:req.body.productId}, "name": productName});
      console.log("productNameExist find result", productNameExist);
      if (productNameExist) {
        req.flash("error", translations.product_name_exixts_update);
        return res.send({
          status: "fail",
          message: "Product name already Exist!"
        });
      }
      
      let productImage = product[0].productImage;
      if (req.files?.productImage) {
        let image = req.files.productImage;
        console.log(image);
        let re = /(?:\.([^.]+))?$/;
        let imageName = image.name.split('.')[0];
        let extension = re.exec(image.name)[1];
        let extentionArray = ['jpg', 'jpeg', 'png'];
        if (!extentionArray.includes(extension.toLowerCase())) {
          req.flash("error", translations.product_not_added_image_validation_update)
          return res.send({
            status: "fail",
            message: "Only JPG,JPEG and PNG files are allowed!"
          });
        }
        let randomNum = Math.floor(100000 + Math.random() * 900000);
        let fileName = imageName + '_' + randomNum + '.' + extension;
        // Use the mv() method to place the file somewhere on your server
        image.mv('public/assets/product/' + fileName, function (err) {
            if (err) {
                console.log(err);
                req.flash('error', translations.error_uploading_image);
                return res.redirect('/player');
            }
        });
        let imagePath = '/assets/product/' + fileName;
        productImage = imagePath;
        const deleteFile = 'public' + product[0].productImage;
        if (fs.existsSync(deleteFile)) {
            fs.unlink(deleteFile, (err) => {
                if (err) {
                  req.flash("error", "Product Image delete Failed!");
                  return res.send({
                    status: "fail",
                    message: "Product Image delete Failed!"
                  });
                }
                console.log('deleted');
            })
        }
      }
      let data = {
        name: productName,
        price: req.body.price,
        category: req.body.category,
        productImage: productImage,
        status: req.body.status,
        updatedAt: Date.now()
      }
      console.log("updating product data",data);
      let response = await Sys.App.Services.ProductServices.updateProduct({ "_id": req.body.productId }, data);
      console.log("response after product update", response);
      if (!response || response == null) {
        req.flash("error", translations.product_update_failed);
        return res.send({
          status: "fail",
          message: "Product Update Failed!"
        });
      }
      req.flash("success", translations.product_updated);
      return res.send({
        status: "success",
        message: "Product edited!"
      });
    } catch (error) {
      console.log("Error in edit Product",error);
      req.flash("error",await Sys.Helper.bingo.getTraslateData(["server_error"], req.session.details.language)) //"Server Error!");
      return res.send({
        status: "fail",
        message: "Server Error"
      });
    }
    
  },

  deleteProduct: async function (req, res) {
    try {
      console.log("requested deleteProduct", req.body);
      let data = req.body.id;
      if (data.length !== 0) {
        let product = await Sys.App.Services.ProductServices.getFindOneByData({ "_id": data });
        if (!product) {
          req.flash("error",await Sys.Helper.bingo.getTraslateData(["product_does_not_exist"], req.session.details.language)) //"Product Does Not Exist!");
          return res.send({
            status: "fail",
            message: "Product Does Not Exist!"
          });
        }
        const deleteFile = 'public' + product.productImage;
        if (fs.existsSync(deleteFile)) {
            fs.unlink(deleteFile, (err) => {
                if (err) {
                  req.flash("error", "Product Image delete Failed!");
                  return res.send({
                    status: "fail",
                    message: "Product Image delete Failed!"
                  });
                }
                console.log('deleted');
            })
        }
        let deleteProduct = await Sys.App.Services.ProductServices.deleteProduct(data);
        console.log("Product Deleted",deleteProduct);
        return res.send("success");
      } else {
        console.log("Wrong Input");
        return res.send("fail");
      }
    } catch (error) {
      console.log("Error in delete Product",error);
      return res.send("fail");
    }
  },

  // Category
  
  getCategories: async function (req, res) {
    try {
      console.log("Get Categories :::: >>>",req.body);
      let query = {
        "status" : {
          $eq : "active"
        }
      }
      let select = {
        _id : 1,
        name:1
      }
      let data = await Sys.App.Services.CategoryServices.getByData(query, select);
      console.log("data of categories :",data);
      return res.send({
        'status': 500,
        'message': 'Category Found!',
        'data': data
      });
    } catch (e) {
      console.log("Error", e);
      return res.send({
        'status': 400,
        'message': 'Server Side Error, Try Again after Sometime.',
        'data': []
      });
    }
  },

  categoryListPage: async function(req,res){
    try {
      console.log("CategoryList",req.body);
      let editFlag = true;
      let deleteFlag = true;
      let addFlag = true;
      let viewFlag = true;
      if(!req.session.details.isSuperAdmin){
        // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
        // if (user == null || user.length == 0) {
        //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
        // }
        // let stringReplace = user.permission['Product Management'] || [];
        let stringReplace =req.session.details.isPermission['Product Management'] || [];
        if(!stringReplace.length){
            let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
            req.flash('error',translate.no_permission )//'you_have_no_permission';
            return res.redirect('/dashboard');
        }
        // var stringReplace = req.session.details.isPermission['Category Management'];

        if (!stringReplace || stringReplace.indexOf("edit") == -1) {
          editFlag = false;
        }
        if (!stringReplace || stringReplace.indexOf("delete") == -1) {
          deleteFlag = false;
        }
        if (!stringReplace || stringReplace.indexOf("add") == -1) {
          addFlag = false;
        }
        if (!stringReplace || stringReplace.indexOf("view") == -1) {
          viewFlag = false;
        }
      }

      const keysArray = [
        "category_management",
        "add_category",
        "category_name",
        "active",
        "inactive",
        "sr_no",
        "delete_message",
        "delete_button",
        "cancel_button",
        "category_deleted",
        "category_delete_cancel",
        "something_went_wrong",
        "cancelled",
        "deleted",
        "failed",
        "active", 
        "inactive",
        "dashboard",
        "search",
        "show",
        "entries",
        "previous",
        "next",
        "submit",
        "action",
        "status",
        "cancel"
      ]
          
      let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

      var data = {
        App: Sys.Config.App.details,
        Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        productManagement: 'active',
        categoryList: 'active',
        editFlag: editFlag,
        deleteFlag: deleteFlag,
        addFlag: addFlag,
        viewFlag: viewFlag,
        categoryData: lanTransaltion,
        navigation: lanTransaltion
      };


      if (viewFlag) {
        return res.render('Products/category-list', data);
      } else {
        req.flash('error', 'You are Not allowed to access that page.');
        return res.redirect('/dashboard');
      }

    } catch (e) {
      console.log("Error in CategoryList Page", e);
      return new Error(e);
    }

  },

  categoryDataTable: async function(req,res){
    try {
      console.log("Category Request ::::", req.query);
      let order = req.query.order;
      let params = req.query.params;
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
      let query = { $and: [{ name: { $regex: '.*' + search + '.*', $options: 'i' } }] };
      let categoryCount = await Sys.App.Services.CategoryServices.getCategoryCount(query);
      console.log("final query", query);
      let data = await Sys.App.Services.CategoryServices.getCategoryDatatable(query, length, start, sort);

      var obj = {
        'draw': req.query.draw,
        'recordsTotal': categoryCount,
        'recordsFiltered': categoryCount,
        'data': data
      };
      return res.send(obj);
    } catch (e) {
      console.log("Error", e);
      return res.send({
        'status': 500,
        'message': 'Server Side Error, Try Again after Sometime.',
        'draw': req.query.draw,
        'recordsTotal': 0,
        'recordsFiltered': 0,
        'data': []
      });
    }
  },

  addCategory: async function (req, res) {
    try {
      console.log("requested appCategory", req.body);
      let categoryName = req.body.name.trim();
      console.log('categoryName',categoryName);

      let translations = await Sys.Helper.bingo.getTraslateData(["enter_category_name", "category_exists", "category_not_added", "category_added"], req.session.details.language);

      if(!categoryName.length){
        req.flash("error", translations.enter_category_name)
        return res.send({
          status: "fail",
          message: "Please enter category name!"
        });
      }
      let category = await Sys.App.Services.CategoryServices.getByData({ "name": categoryName });
      console.log("category find result", category);
      if (category.length !== 0) {
        req.flash("error", translations.category_exists)
        return res.send({
          status: "fail",
          message: "Category Already Exist!"
        });
      }
      
      let data = {
        name: categoryName,
        status: req.body.status
      }
      let response = await Sys.App.Services.CategoryServices.insertCategoryData(data);
      if (!response || response instanceof Error) {
        req.flash("error", translations.category_not_added)
        return res.send({
          status: "fail",
          message: "Category not Added!"
        });
      }
      console.log("Category Response", response);
      req.flash("success", translations.category_added)
      return res.send({
        status: "success",
        message: "Category Created Successfully!"
      });
    } catch (error) {
      console.log("Error in add Category Controller", error);
      req.flash("error", translations.category_not_added)
      return res.send({
        status: "fail",
        message: "Category not Added!"
      });
    }
  },

  editCategory: async function (req, res) {
    try {
      console.log("requested editCategory", req.body);
      let category = await Sys.App.Services.CategoryServices.getByData({ "_id": req.body.categoryId });
      console.log("category find result", category);
      let translations = await Sys.Helper.bingo.getTraslateData(["category_not_exists", "enter_category_name", "category_name_exists_update", "category_upate_failed", "category_updated"], req.session.details.language);
      if (category.length == 0) {
        req.flash("error", translations.category_not_exists);
        return res.send({
          status: "fail",
          message: "Category Does Not Exist!"
        });
      }
      let categoryName = req.body.name.trim();
      console.log('categoryName',categoryName);
      if(!categoryName.length){
        req.flash("error", translations.enter_category_name)
        return res.send({
          status: "fail",
          message: "Please enter category name!"
        });
      }
      let categoryNameExist = await Sys.App.Services.CategoryServices.getOneByData({ "_id":{$ne:req.body.categoryId},"name": categoryName});
      if(categoryNameExist){
        req.flash("error", translations.category_name_exists_update)
        return res.send({
          status: "fail",
          message: "Category name already exist"
        });
      }
      let data = {
        name: categoryName,
        status: req.body.status,
        updatedAt: Date.now()
      }
      console.log("updating category data", data);
      let response = await Sys.App.Services.CategoryServices.updateCategory({ "_id": req.body.categoryId }, data);
      console.log("response after category update", response);
      if (!response || response == null) {
        req.flash("error", translations.category_upate_failed);
        return res.send({
          status: "fail",
          message: "Category Update Failed!"
        });
      }
      req.flash("success", translations.category_updated);
      return res.send({
        status: "success",
        message: "Category edited!"
      });
    } catch (error) {
      console.log("Error in edit Category", error);
      req.flash("error",await Sys.Helper.bingo.getTraslateData(["server_error"], req.session.details.language)) //"Server Error!");
      return res.send({
        status: "fail",
        message: "Server Error"
      });
    }

  },

  deleteCategory: async function (req, res) {
    try {
      console.log("requested deleteCategory", req.body);
      let data = req.body.id;
      let productCount = await Sys.App.Services.ProductServices.getProductCount({ "category": req.body.id });
      console.log("productCount", productCount);
      if (productCount && productCount > 0) {
        return res.send({
          status: "fail",
          message:"Unassign Category from Products first !"
        });
      }
      if (data.length !== 0) {
        let deleteCategory = await Sys.App.Services.CategoryServices.deleteCategory(data);
        console.log("Category Deleted", deleteCategory);
        res.send({
          status: "success",
          message: "Product Deleted!"
        });
      } else {
        return res.send({
          status: "fail",
          message: "Not Found!"
        });
      }
    } catch (error) {
      console.log("Error in delete Category", error);
      return res.send({
        status: "fail",
        message: "Server Error!"
      });
    }
  },

  //Hall-Product

  hallProductListPage: async function (req, res) {
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
          // let stringReplace = user.permission['Product Management'] || [];
          let stringReplace =req.session.details.isPermission['Product Management'] || [];
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
      let keys = []
      let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
      let data = {
        App: Sys.Config.App.details,
        Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        productManagement: 'active',
        hallProductList: 'active',
        viewFlag: viewFlag,
        editFlag: editFlag,
        deleteFlag: deleteFlag,
        addFlag: addFlag,
        translate: translate,
        navigation: translate
      };
      return res.render('Products/hall-products', data);
    } catch (e) {
      console.log("Error in productList Page", e);
      return new Error(e);
    }
  },

  getHallsandProducts : async function (req,res) {
    try {
      console.log("req.query", req.query);
      let query = {
        "status" : 'active',
        "agents": { "$not": { "$size": 0 } }
      }
      if (req.session.details.role == "agent") {
        query['_id'] = req.session.details.hall[0].id
      }
      let start = parseInt(req.query.start);
      let length = parseInt(req.query.length);
      let halls = await Sys.App.Services.HallServices.getPopulatedHall(query,length,start);
      console.log(halls);
      if (halls) {
        let data = halls.map(h=>{
          return {
            "_id": h._id,
            "hallId":h.hallId,
            "name":h.name,
            "products":h?.products.map(p=>{return {"id":p._id,"text":p.name}})
          }
        })
        return res.send({
          'draw': req.query.draw,
          'recordsTotal': data.length,
          'recordsFiltered': data.length,
          'data': data
        });
      }else{
        return res.send({
          'draw': req.query.draw,
          'recordsTotal': 0,
          'recordsFiltered': 0,
          'data': []
        });
      }
    } catch (error) {
      console.log("error in getHallsandProducts API", error);
      return res.send({
        'draw': req.query.draw,
        'recordsTotal': 0,
        'recordsFiltered': 0,
        'data': []
      });
    }
  },
  getHallWithProduct : async function(req, res) {
    try {
      console.log("req.query", req.params);
      let hall = await Sys.App.Services.HallServices.getSingleHall({"_id" : req.params.id})
      if (hall) {
        let query = {
          "status": "active"
        }
        if (req.session.details.role == "agent") {
          query['$or'] = [{
            "adminProduct" : true
          },{
            "createdBy": req.session.details.id
          }]
        }
        let products = await Sys.App.Services.ProductServices.getByData(query, null, null, null, { _id: 0, name: 1 });
        let selectedProducts = hall.products;
        products = products.map((p)=>{
          return{
            "id":p._id,
            "text":p.name
          }
        });
        res.send({
          status : "success",
          data : {
            selectedProducts : selectedProducts,
            products: products
          }
        })
      }
    } catch (error) {
      console.log("error in getHallWithProduct API", error);
    }
  },

  updateProductinHall: async function (req, res) {
    try {
      console.log("product",req.body);
      let products = []
      if (req.body.products) {
        if (typeof req.body.products === 'string' || req.body.products instanceof String) {
          products.push(req.body.products)
        } else if (req.body.products){
          products = req.body.products;
        }
      }
      products = products.map(p=>mongoose.Types.ObjectId(p));
      let hall = await Sys.App.Services.HallServices.updateHallData({"_id": mongoose.Types.ObjectId(req.body.hallId)},{
        "$set" : {
          "products" : products
        }
      })
      return res.send("ok");
    } catch (error) {
      console.log(error);
      return res.status(500).send("error");
    }
  },
}