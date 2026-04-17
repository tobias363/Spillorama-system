
var BASEURL= window.origin+'/';
let now = new Date();

$(document).on('keydown','input[type="number"]',function(e){
  if ($.inArray(e.keyCode, [46, 8, 9, 27, 13, 110, 190]) !== -1 ||
      (e.keyCode === 65 && (e.ctrlKey === true || e.metaKey === true)) || 
      (e.keyCode >= 35 && e.keyCode <= 40)) {
           return;
  }
  if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
  }
});



/**
 * 
 * @param {All popup function will call here } type 
 */

function callDynamicModal(type,data={}){
  console.log("type type : "+type+" data data : "+data);
  //return false;

    var $modal = $('#ajax-modal');
    $modal.load(BASEURL+'popup_modal',{'modalType': type,data:data}, 
    function(){ 
      $modal.modal({
        backdrop: 'static',
        keyboard: false
      });
      
      if(type=='physicalTicket'){
        
        let newTime;
        let utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
        newTime = utc.getTime() + 2 * 60000;
        $('#uipd').datetimepicker({
            minDate: newTime,
        }).on('dp.change',function(e){
          
            console.log("++++++++++++++++++++++ dp.change ",e);

             if($('#uied').val() && $('#uipd').val()){
                let end = $('#uied').val();
                let start = $('#uipd').val();

                const dateOneObj = new Date(start);
                const dateTwoObj = new Date(end);
                const milliseconds = Math.abs(dateTwoObj - dateOneObj);
                const hours = milliseconds / 36e5;

                console.log(" hours hours : "+hours)
                if(parseInt(hours)>0){
                  $('#physical_validity').val(parseInt(hours));
                }

             }
        });

        let newTime1;
        let utc1 = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
        newTime1 = utc1.getTime() + 2 * 60000;
        $('#uied').datetimepicker({
            minDate: newTime1,
        }).on('dp.change',function(e){
          //console.log("++++++++++++++++++++++ dp.change ",e);
             if($('#uied').val() && $('#uipd').val()){
                let end = $(this).val();
                let start = $('#uipd').val();

                const dateOneObj = new Date(start);
                const dateTwoObj = new Date(end);
                const milliseconds = Math.abs(dateTwoObj - dateOneObj);
                const hours = milliseconds / 36e5;

                console.log(" hours hours : "+hours)
                if(parseInt(hours)>0){
                  $('#physical_validity').val(parseInt(hours));
                }

             }
        });


        $.formUtils.addValidator({
          name: 'physicalUniqueId',
          validatorFunction: function(value, $el, config, language, $form) {
              // let startDate = document.getElementById("physicalUniqueId").value;
              // return value > startDate
              // $.ajax({
              //   type:"POST",
              //   dataType: "json",
              //   url: BASEURL+"checkUniqueId",
              //   data: {uniqueId:$(this).val()},
              //   success: function(response){
              //     return false
              //   }
              // });
              return false;
          },
          errorMessage: 'Grace Period Must be greater than Start Date',
          errorMessageKey: 'physicalUniqueId'
        });

      }
      if(type=='printPhysicalTicket'){
          var divContents = document.getElementById("printdivcontent").innerHTML;  
          var printWindow = window.open('', '', 'height=200,width=400');  
          printWindow.document.write(`<html><head><title>physical ticket</title>
                                            <style type="text/css">
                                            html, body, div, span, object, iframe,
                                            h1, h2, h3, h4, h5, h6, p, blockquote, pre,
                                            abbr, address, cite, code,
                                            del, dfn, em, img, ins, kbd, q, samp,
                                            small, strong, sub, sup, var,
                                            b, i,
                                            dl, dt, dd, ol, ul, li,
                                            fieldset, form, label, legend,
                                            table, caption, tbody, tfoot, thead, tr, th, td {
                                                margin: 0;
                                                padding: 0;
                                                border: 0;
                                                outline: 0;
                                                font-size: 100%;
                                                vertical-align: baseline;
                                                background: transparent;
                                            }          

                                            table {
                                              overflow: hidden
                                              border: 1px solid #d3d3d3;
                                              background: #fefefe;
                                              width: 70%;
                                              margin: 5% auto 0;
                                              -moz-border-radius: 5px; /* FF1+ */
                                              -webkit-border-radius: 5px; /* Saf3-4 */
                                              border-radius: 5px;
                                              -moz-box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
                                              -webkit-box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
                                          }
                                      
                                          th, td {
                                              padding: 15px 24px 15px;
                                              text-align: center;
                                          }
                                      
                                          th {
                                              padding-top: 22px;
                                              text-shadow: 1px 1px 1px #fff;
                                              background: #e8eaeb;
                                          }
                                      
                                          td {
                                              border-top: 1px solid #e0e0e0;
                                              border-right: 1px solid #e0e0e0;
                                          }
                                      
                                          tr.odd-row td {
                                              background: #f6f6f6;
                                          }
                                      
                                          td.first, th.first {
                                              text-align: left
                                          }
                                      
                                          td.last {
                                              border-right: none;
                                          }
                                      
                                          /*
                                          Background gradients are completely unnecessary but a neat effect.
                                          */
                                      
                                          td {
                                              background: -moz-linear-gradient(100% 25% 90deg, #fefefe, #f9f9f9);
                                              background: -webkit-gradient(linear, 0% 0%, 0% 25%, from(#f9f9f9), to(#fefefe));
                                          }
                                      
                                          tr.odd-row td {
                                              background: -moz-linear-gradient(100% 25% 90deg, #f6f6f6, #f1f1f1);
                                              background: -webkit-gradient(linear, 0% 0%, 0% 25%, from(#f1f1f1), to(#f6f6f6));
                                          }
                                      
                                          th {
                                              background: -moz-linear-gradient(100% 20% 90deg, #e8eaeb, #ededed);
                                              background: -webkit-gradient(linear, 0% 0%, 0% 20%, from(#ededed), to(#e8eaeb));
                                          }
                                      
                                          tr:first-child th.first {
                                              -moz-border-radius-topleft: 5px;
                                              -webkit-border-top-left-radius: 5px; /* Saf3-4 */
                                          }
                                      
                                          tr:first-child th.last {
                                              -moz-border-radius-topright: 5px;
                                              -webkit-border-top-right-radius: 5px; /* Saf3-4 */
                                          }
                                      
                                          tr:last-child td.first {
                                              -moz-border-radius-bottomleft: 5px;
                                              -webkit-border-bottom-left-radius: 5px; /* Saf3-4 */
                                          }
                                      
                                          tr:last-child td.last {
                                              -moz-border-radius-bottomright: 5px;
                                              -webkit-border-bottom-right-radius: 5px; /* Saf3-4 */
                                          }
                                      
                                        /* ++++++++++++++++++++++++++ */
                                          @page {
                                            size: 3in 3in;
                                            margin: 0% 0% 0% 0%;
                                          }

                                          @media print {
                                            html, body {
                                              font-size: 11pt; /* changing to 4pt has no impact */
                                            }
                                            label {
                                              font-size: 11pt; /* changing to 4pt has no impact */
                                            }
                                          }
                                        /* --------------------------- */	
                                      </style>
                                    `);  
          printWindow.document.write('</head><body>');  
          printWindow.document.write(divContents);  
          printWindow.document.write('</body></html>');  
          printWindow.document.close();  
          printWindow.print();  

          $('#ajax-modal').modal('hide');

      }
      
      $('.modal-body .tab-content').slimScroll({
        height: '400px',
        width: '100%'
     });
      
    });
}



$(document).on("click", "#physicalTicketAdd", function(){
 
let gameId=$(this).attr("game_id");

callDynamicModal('physicalTicket',{gameId:gameId});

});
let colorPrices=[];
$(document).on("change", '#physicalTicketGameId', function(){
   //let gameId= $(this).val();
   let gameId = $("#physicalTicketGameId option:selected").attr("subid");
   console.log("+++++++++++++++ : "+gameId)
   let gameJson =  $('#game1DataPhysical').val();
   let gamesData = JSON.parse(gameJson.replace(/&quot;/g, '"'));
   let htm='<option value="">Select color</option>';
   let sgame=gamesData.subGames;
   for(rr in sgame){
     if(gameId==sgame[rr].subGameId){
       let tcolor = sgame[rr].ticketColorTypesNo;
       colorPrices = tcolor;
       for(cc in tcolor){
        htm +=`<option value="${tcolor[cc].ticketType}">${tcolor[cc].ticketName}</option>`;
       }

     }
    
   }
   //console.log("+++++++++++++++++++++++ :  :",htm)
   $('#gamesTicketColors').empty();
   $('#gamesTicketColors').append(htm);

});


$(document).on('change','#gamesTicketColors', function(){
 let value = $("#gamesTicketColors option:selected").attr("pval");
 console.log(" value value value : ",value)
 $('input[name="ticketprice"]').val(value);
 let ticketVal = $(this).val();
 let oticketType = $("#gamesTicketColors option:selected").attr("otickettype");

 if(oticketType && ticketVal==oticketType){
  
    document.getElementById("btnReGenerateTicket").disabled = true;
    document.getElementById("btnRePrintPhysicalTicket").disabled = true;
   
 }else if(oticketType && ticketVal!=oticketType){
  document.getElementById("btnReGenerateTicket").disabled = false;
  document.getElementById("btnRePrintPhysicalTicket").disabled = false;
 }
//  for(j=0;j<(colorPrices.length);j++){
//    if(colorPrices[j].ticketType==value){
//      $('input[name="ticketprice"]').val(colorPrices[j].ticketPrice);
//      break;
//    }
//  }

});

$(document).on('change','#gamesTicketColors1', function(){
  let value = $("#gamesTicketColors1 option:selected").attr("pval");
  console.log(" value value value : ",value)
  $('input[name="ticketprice1"]').val(value);
  let ticketVal = $(this).val();
  let oticketType = $("#gamesTicketColors1 option:selected").attr("otickettype");
 
  if(oticketType && ticketVal==oticketType){
   
     document.getElementById("btnReGenerateTicket").disabled = true;
     document.getElementById("btnRePrintPhysicalTicket").disabled = true;
    
  }else if(oticketType && ticketVal!=oticketType){
   document.getElementById("btnReGenerateTicket").disabled = false;
   document.getElementById("btnRePrintPhysicalTicket").disabled = false;
  }
 //  for(j=0;j<(colorPrices.length);j++){
 //    if(colorPrices[j].ticketType==value){
 //      $('input[name="ticketprice"]').val(colorPrices[j].ticketPrice);
 //      break;
 //    }
 //  }
 
 });

$(document).on('click','#btnCancelPhysicalTicket', function(){
  $("#ajax-modal").modal("hide");
 
 });



$(document).on('click','#uipd', function(){
  console.log(" uipd uipd uipd uipd :")
  if($('#uipd').val() && $('#uied').val()){
    let end =$('#uied').val();
    let start = $('#uipd').val();

    const dateOneObj = new Date(start);
    const dateTwoObj = new Date(end);
    const milliseconds = Math.abs(dateTwoObj - dateOneObj);
    const hours = milliseconds / 36e5;

    console.log(" hours hours : "+hours)
    if(parseInt(hours)>0){
      $('#physical_validity').val(parseInt(hours));
    } 

  }
});



$(document).on('click','#uied', function(){
  console.log(" uied uied uied uied :")
 if($('#uied').val() && $('#uipd').val()){
    let end = $(this).val();
    let start = $('#uipd').val();

    const dateOneObj = new Date(start);
    const dateTwoObj = new Date(end);
    const milliseconds = Math.abs(dateTwoObj - dateOneObj);
    const hours = milliseconds / 36e5;

    console.log(" hours hours : "+hours)
    if(parseInt(hours)>0){
      $('#physical_validity').val(parseInt(hours));
    }

 }

});  



$(document).on('click','#btnGenerateTicket', function(){

  let btnVal = $(this).val();
  let btnObj=$(this);
 
  if(!($('input[name="physicalTicketGameId"]').val())){
    return $.toast({heading: '',text: 'Sub Game Not Available',position: 'top-right',icon: 'error'});
  }
  if($("#physicalTicketForm").valid()){
    
    var myform = document.getElementById("physicalTicketForm");
    var fd = new FormData(myform);
    
    $.ajax({
      type:"POST",
      dataType: "json",
      url: BASEURL+"generateTicket",
      cache: false,
      processData: false,
      contentType: false,
      data: fd,
      beforeSend: function(){
        btnObj.val("Wait..");
        btnObj.attr("disabled","disabled"); 
      },
      complete: function(){
        btnObj.val(btnVal);
        btnObj.removeAttr("disabled");
      },
      success: function(response){
          console.log("updated value",response)
           if(response.status){
            
            callDynamicModal("generatedTicket",{generatedTicket:response.result.ticketCode,ticketId:response.result.ticketId });
            dataTableDataEditPhysical();
           }else{
             return $.toast({heading: '',text: response.message,position: 'top-right',icon: 'error'});
           }
      }
    });
  }
});

/**
 * Edit physical ticket start
 */

 $(document).on('click','#btnReGenerateTicket', function(){
  let btnVal = $(this).val();
  let btnObj=$(this);

  if(!($('input[name="physicalTicketGameId"]').val())){
    return $.toast({heading: '',text: 'Sub Game Not Available',position: 'top-right',icon: 'error'});
  }
  if($("#physicalTicketEditForm").valid()){
    
    var myform = document.getElementById("physicalTicketEditForm");
    var fd = new FormData(myform);

    $.ajax({
      type:"POST",
      dataType: "json",
      url: BASEURL+"generateEditTicket",
      cache: false,
      processData: false,
      contentType: false,
      data: fd,
      beforeSend: function(){
        btnObj.val("Wait..");
        btnObj.attr("disabled","disabled"); 
      },
      complete: function(){
        btnObj.val(btnVal);
        btnObj.removeAttr("disabled");
      },
      success: function(response){
          console.log("updated value ------------------- ",response)
           if(response.status){
            
            callDynamicModal("generatedTicket",{generatedTicket:response.result.ticketCode,ticketId:response.result.ticketId});
            dataTableDataEditPhysical();

           }else{
             return $.toast({heading: '',text: response.message,position: 'top-right',icon: 'error'});
           }
      }
    });
  }
});


$(document).on('click','#btnRePrintPhysicalTicket', function(){
  let btnVal = $(this).val();
  let btnObj=$(this);

  if(!($('input[name="physicalTicketGameId"]').val())){
    return $.toast({heading: '',text: 'Sub Game Not Available',position: 'top-right',icon: 'error'});
  }

  if($("#physicalTicketEditForm").valid()){
      var myform = document.getElementById("physicalTicketEditForm");
      var fd = new FormData(myform );
      $.ajax({
        type:"POST",
        dataType: "json",
        url: BASEURL+"generateEditTicket",
        cache: false,
        processData: false,
        contentType: false,
        data: fd,
        beforeSend: function(){
          btnObj.val("Wait..");
          btnObj.attr("disabled","disabled"); 
        },
        complete: function(){
          btnObj.val(btnVal);
          btnObj.removeAttr("disabled");
        },
        success: function(response){
          console.log("updated value",response)
            if(response.status){
              
              callDynamicModal("printPhysicalTicket",{generatedTicket:response.result.ticketCode,ticketId:response.result.ticketId});  
              dataTableDataEditPhysical();                                                                       
            }else{
              return $.toast({heading: '',text: response.message,position: 'top-right',icon: 'error'});
            }
        }
      }); 
  }    

});


$(document).on('click','.editPhysicalTickets', function(){
      let ticketId=$(this).attr("ticketid");
      let gameId=$(this).attr("gameid");
      callDynamicModal("editPhysicalTicket",{gameId:gameId,ticketId:ticketId});
});



$(document).on('click','#btnPrintPhysicalTicket', function(){
  let btnVal = $(this).val();
  let btnObj=$(this);

  if(!($('input[name="physicalTicketGameId"]').val())){
    return $.toast({heading: '',text: 'Sub Game Not Available',position: 'top-right',icon: 'error'});
  }

  if($("#physicalTicketForm").valid()){
      var myform = document.getElementById("physicalTicketForm");
      var fd = new FormData(myform );
      $.ajax({
        type:"POST",
        dataType: "json",
        url: BASEURL+"generateTicket",
        cache: false,
        processData: false,
        contentType: false,
        data: fd,
        beforeSend: function(){
          btnObj.val("Wait..");
          btnObj.attr("disabled","disabled"); 
        },
        complete: function(){
          btnObj.val(btnVal);
          btnObj.removeAttr("disabled");
        },
        success: function(response){
          console.log("updated value physicalTicketForm ",response)
            if(response.status){
              callDynamicModal("printPhysicalTicket",{generatedTicket:response.result.ticketCode,ticketId:response.result.ticketId});
              dataTableDataEditPhysical();
            }else{
              return $.toast({heading: '',text: response.message,position: 'top-right',icon: 'error'});
            }
        }
      }); 
  }    
});


  
let newTime;
let utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
newTime = utc.getTime() + 2 * 60000;
$('#uipd').datetimepicker({
    minDate: newTime,
});

let newTime1;
let utc1 = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
newTime1 = utc1.getTime() + 2 * 60000;
$('#uied').datetimepicker({
    minDate: newTime1,
}).on("change", function() {
    console.log("++++++++++++++++++++++++ uied ::::::::::::: ")
});





/**
 * @ add * withdraw unique ticket 
 */


 $(document).on("click", "#uniqueTicketAdd", function(){
  let pid=$(this).attr("pid");
  callDynamicModal('uniqueWalletAdd',{id:pid});
  
  });


  $(document).on("click", "#uniqueTicketWithdraw", function(){
    let pid=$(this).attr("pid");
    callDynamicModal('uniqueTicketWithdraw',{id:pid});
    
  });

  $(document).on("click","#unique_withdraw_btn", function(){
    
    if($('#uniqueWithdrawForm').valid()){

      let action = $('#uniqueWithdrawForm').attr("action");
      let pid =$('#unique_withdraw_btn').attr("data-id"); 

      let amt =$('input[name="unique_amount_dw"]').val();
      if(amt){
        amt=(amt*1);
      }
      let userBal = $('#userWalletBalance').html();
      if(userBal){
        userBal=(userBal*1);
      }
      if(amt>userBal){
       return $.toast({heading: 'Error',text: 'Withdral balance need to be less',position: 'top-right',icon: 'error'});
      }

      $.ajax({
        type:"POST",
        dataType: "json",
        url: BASEURL+action,
        data: {type:'withdraw', amount : amt, pid:pid},
        success: function(response){
          console.log("updated value",response)
             if(!response.status){

              $.toast({heading: 'Error',text: response.message ,position: 'top-right',icon: 'error'});
             }else{
                $('#userWalletBalance').html(response.result.data.walletAmount);
                $('input[name="unique_amount_dw"]').val('');
             }
        }
      });
    }
   
  });


  $(document).on("click","#unique_deposit_btn", function(){
    
    if($('#uniqueWithdrawForm').valid()){
        let action = $('#uniqueWithdrawForm').attr("action");
        let pid =$('#unique_deposit_btn').attr("data-id"); 

        let amt =$('input[name="unique_amount_dw"]').val();
        if(amt){
          amt=(amt*1);
        }
       
        console.log(" action : "+BASEURL+action+" pid pid :"+pid+" amt : "+amt)

        $.ajax({
          type:"POST",
          dataType: "json",
          url: BASEURL+action,
          data: {type:'deposit', amount : amt, pid:pid},
          success: function(response){
            console.log("updated value",response)
               if(!response.status){
                $.toast({heading: 'Error',text: response.message ,position: 'top-right',icon: 'error'});
               }else{
                  $('#userWalletBalance').html(response.result.data.walletAmount);
                  $('input[name="unique_amount_dw"]').val('');
               }
          }
        }); 
    }

  });  

  $(document).on("focusout","#physicalUniqueId", function(){
      console.log(" focus out data :++++++++++++++++ ")
      if($(this).val()){
        $.ajax({
          type:"POST",
          dataType: "json",
          url: BASEURL+"checkUniqueId",
          data: {uniqueId:$(this).val()},
          success: function(response){
            console.log("++++++++++++++++++++++++++++ : ", response)
            $('input[name="uipd"]').val('');
            $('input[name="uied"]').val('');
            $('input[name="validity"]').val('');
            $('#physicalUniqueId-error').remove();
            $('#physicalUniqueId').css({'border-color':''});
            $('#physicalUniqueId').removeClass("error");

            if(!response.status){
              $('#physicalUniqueId').after(`<label id="physicalUniqueId-error" class="error" for="physicalUniqueId">${response.message}</label>`);
              $('#physicalUniqueId').css({'border-color':'red'});
              $('#physicalUniqueId').removeClass('valid').addClass('error');
              //$.toast({heading: 'Error',text: response.message ,position: 'top-right',icon: 'error'});
              $('#btnGenerateTicket,#btnPrintPhysicalTicket').attr("disabled","disabled"); 
            }else{
              
              $('#btnGenerateTicket,#btnPrintPhysicalTicket').removeAttr("disabled"); 

              function dateFormat(ddt){
                let dt = new Date(ddt);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                
                hours = hours % 12;
                hours = hours<10 ? '0'+hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                month = month < 10 ? '0' + month : month;
                let newDt = year + '-' + month + '-' + date + ' ' + hours + ':' + minutes;
                return newDt;
              }

                $('input[name="uipd"]').val(dateFormat(response.result.data.uniquePurchaseDate));
                $('input[name="uied"]').val(dateFormat(response.result.data.uniqueExpiryDate));
                $('input[name="validity"]').val(response.result.data.hoursValidity);
            }
          }
        });
      }
  });

  $(document).on("focusout","#physicalUniqueTicketId", function(){
    console.log(" focus out data :++++++++++++++++ ")
    if($(this).val()){
      $('#btnGenerateTicket,#btnPrintPhysicalTicket').removeAttr("disabled"); 
    }
});



  $(document).on("click","#btnUniqueIdView", function(){
    var divContents = document.getElementById("printUniqueIdView").innerHTML;  
    var printWindow = window.open('', '', 'height=200,width=400');  
    printWindow.document.write('<html><head><title></title>');  
    printWindow.document.write('</head><body >');  
    printWindow.document.write(divContents);  
    printWindow.document.write('</body></html>');  
    printWindow.document.close();  
    printWindow.print();  
  });


  $(document).ready(function(){
  //   $.formUtils.addValidator({
  //     name: 'uied_unique',
  //     validatorFunction: function(value, $el, config, language, $form) {
  //         let startDate = document.getElementById("uipd_unique").value;
  //         return value > startDate
  //     },
  //     errorMessage: 'Grace Period Must be greater than Start Date',
  //     errorMessageKey: 'uied_unique'
  // });
  })



  // $.formUtils.addValidator({
  //   name: 'physicalUniqueId',
  //   validatorFunction: function(value, $el, config, language, $form) {
  //       // let startDate = document.getElementById("physicalUniqueId").value;
  //       // return value > startDate
       
  //       return false;
  //   },
  //   errorMessage: 'Grace Period Must be greater than Start Date',
  //   errorMessageKey: 'physicalUniqueId'
  // });
  
  // $.formUtils.addValidator({
  //   name: 'uipd',
  //   validatorFunction: function(value, $el, config, language, $form) {
  //       let graceDate = document.getElementById("uied").value;
  //       if (graceDate == "") {
  //           return true;
  //       } else {
  //           return value < graceDate
  //       }
  //   },
  //   errorMessage: 'Start Date Must be less than Grace Period',
  //   errorMessageKey: 'uipd'
  // });

  /**
   * @ print physical ticket function
   */

   $(document).on("click","#btnPrintPhyTicket", function(){
     let printDivId = $(this).attr("pdid");
    var divContents = document.getElementById(printDivId).innerHTML;  
    console.log(" divContents divContents  : "+divContents)
    var printWindow = window.open('', '', 'height=200,width=400');  
    printWindow.document.write(`<html><head><title>physical ticket</title>
                                    <style type="text/css">
                                        html, body, div, span, object, iframe,
                                        h1, h2, h3, h4, h5, h6, p, blockquote, pre,
                                        abbr, address, cite, code,
                                        del, dfn, em, img, ins, kbd, q, samp,
                                        small, strong, sub, sup, var,
                                        b, i,
                                        dl, dt, dd, ol, ul, li,
                                        fieldset, form, label, legend,
                                        table, caption, tbody, tfoot, thead, tr, th, td {
                                            margin: 0;
                                            padding: 0;
                                            border: 0;
                                            outline: 0;
                                            font-size: 100%;
                                            vertical-align: baseline;
                                            background: transparent;
                                        }          

                                        table {
                                          overflow: hidden
                                          border: 1px solid #d3d3d3;
                                          background: #fefefe;
                                          width: 70%;
                                          margin: 5% auto 0;
                                          -moz-border-radius: 5px; /* FF1+ */
                                          -webkit-border-radius: 5px; /* Saf3-4 */
                                          border-radius: 5px;
                                          -moz-box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
                                          -webkit-box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
                                      }
                                  
                                      th, td {
                                          padding: 15px 24px 15px;
                                          text-align: center;
                                      }
                                  
                                      th {
                                          padding-top: 22px;
                                          text-shadow: 1px 1px 1px #fff;
                                          background: #e8eaeb;
                                      }
                                  
                                      td {
                                          border-top: 1px solid #e0e0e0;
                                          border-right: 1px solid #e0e0e0;
                                      }
                                  
                                      tr.odd-row td {
                                          background: #f6f6f6;
                                      }
                                  
                                      td.first, th.first {
                                          text-align: left
                                      }
                                  
                                      td.last {
                                          border-right: none;
                                      }
                                  
                                      /*
                                      Background gradients are completely unnecessary but a neat effect.
                                      */
                                  
                                      td {
                                          background: -moz-linear-gradient(100% 25% 90deg, #fefefe, #f9f9f9);
                                          background: -webkit-gradient(linear, 0% 0%, 0% 25%, from(#f9f9f9), to(#fefefe));
                                      }
                                  
                                      tr.odd-row td {
                                          background: -moz-linear-gradient(100% 25% 90deg, #f6f6f6, #f1f1f1);
                                          background: -webkit-gradient(linear, 0% 0%, 0% 25%, from(#f1f1f1), to(#f6f6f6));
                                      }
                                  
                                      th {
                                          background: -moz-linear-gradient(100% 20% 90deg, #e8eaeb, #ededed);
                                          background: -webkit-gradient(linear, 0% 0%, 0% 20%, from(#ededed), to(#e8eaeb));
                                      }
                                  
                                      tr:first-child th.first {
                                          -moz-border-radius-topleft: 5px;
                                          -webkit-border-top-left-radius: 5px; /* Saf3-4 */
                                      }
                                  
                                      tr:first-child th.last {
                                          -moz-border-radius-topright: 5px;
                                          -webkit-border-top-right-radius: 5px; /* Saf3-4 */
                                      }
                                  
                                      tr:last-child td.first {
                                          -moz-border-radius-bottomleft: 5px;
                                          -webkit-border-bottom-left-radius: 5px; /* Saf3-4 */
                                      }
                                  
                                      tr:last-child td.last {
                                          -moz-border-radius-bottomright: 5px;
                                          -webkit-border-bottom-right-radius: 5px; /* Saf3-4 */
                                      }
                                  
                                    /* ++++++++++++++++++++++++++ */
                                      @page {
                                        size: 3in 3in;
                                        margin: 0% 0% 0% 0%;
                                      }

                                      @media print {
                                        html, body {
                                          font-size: 11pt; /* changing to 4pt has no impact */
                                        }
                                        label {
                                          font-size: 11pt; /* changing to 4pt has no impact */
                                        }
                                      }
                                    /* --------------------------- */	
                                  </style>
                                
                                `);  
    printWindow.document.write('</head><body >');  
    printWindow.document.write(divContents);  
    printWindow.document.write('</body></html>');  
    printWindow.document.close();  
    printWindow.print();  
  });