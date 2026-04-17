let ETICKETCOLORS = [
    'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
    'Large Purple', 'Small Blue', 'Large Blue'
];

$(document).ready(function() {
    let subGames = JSON.parse(subGameColorRow.replace(/&quot;/g, '"'));
    let gamesSubGames = JSON.parse(GameOfSubGame.replace(/&quot;/g, '"'));
    let gamesData = JSON.parse(GamesData.replace(/&quot;/g, '"'));


    console.log(" gamesData gamesData gamesData :",gamesData)
    //isGameTypeExtra
    //console.log(" gamesSubGames gamesSubGames gamesSubGames :",gamesSubGames)

    // [ Dynamic Function ]
    var CheckboxDropdown;
    (function($) {
        CheckboxDropdown = function(el) {
            var _this = this;
            this.isOpen = false;
            this.areAllChecked = false;
            this.$el = $(el);
            this.$label = this.$el.find('.dropdown-label');
            this.$inputs = this.$el.find('[type="checkbox"]');
            let gameName = $(el).children('.commonCls').attr('data-name');
            window.name = gameName;
            this.onCheckBox();

            this.$label.on('click', function(e) {
                e.preventDefault();
                _this.toggleOpen();
            });

            this.$inputs.on('change', function(e) {
                _this.onCheckBox();
            });
        };

        CheckboxDropdown.prototype.onCheckBox = function() {
            this.updateStatus();
        };

        CheckboxDropdown.prototype.updateStatus = function() {
            var checked = this.$el.find(':checked');

            if (checked.length <= 0) {
                this.$label.html(window.name);
            } else if (checked.length === 1) {
                this.$label.html(checked.parent('label').text());
            } else if (checked.length === this.$inputs.length) {
                this.$label.html('All Selected');
                this.areAllChecked = true;
            } else {
                this.$label.html(checked.length + ' Selected');
            }
        };

        CheckboxDropdown.prototype.onCheckAll = function(checkAll) {
            if (!this.areAllChecked || checkAll) {
                this.areAllChecked = true;
                this.$checkAll.html('Uncheck All');
                this.$inputs.prop('checked', true);
            } else {
                this.areAllChecked = false;
                this.$checkAll.html('Check All');
                this.$inputs.prop('checked', false);
            }

            this.updateStatus();
        };

        CheckboxDropdown.prototype.toggleOpen = function(forceOpen) {
            var _this = this;

            if (!this.isOpen || forceOpen) {
                this.isOpen = true;
                this.$el.addClass('on');
                $(document).on('click', function(e) {
                    if (!$(e.target).closest('[data-control]').length) {
                        _this.toggleOpen();
                    }
                });
            } else {
                this.isOpen = false;
                this.$el.removeClass('on');
                $(document).off('click');
            }
        };

        var checkboxesDropdowns = document.querySelectorAll('[data-control="checkbox-dropdown"]');
        for (var i = 0, length = checkboxesDropdowns.length; i < length; i++) {
            new CheckboxDropdown(checkboxesDropdowns[i]);
        }
    })(jQuery);

    $('#gameNameSelect option').each(function() {

        if (this.selected) {

            let idName = $('#gameNameSelect option:selected').toArray().map(item => {
                let newObj = {};
                let be = item.value;
                let fields = be.split('|');
                newObj["gameName"] = fields[1];
                newObj["gameType"] = fields[2];
                return newObj;
            });

            // if (idName.length > 1) {
              
            // }

            $.each(idName, function(key, value) {
                console.log(" idName idName idName idName : ",subGames[value.gameType])
                if (!$("#" + value.gameType).length) {

                    if (subGames[value.gameType]) {

                        // Game, Ticket Color & its Price 
                        let html = `<li id= "${value.gameType}" class="${value.gameType} col-lg-4"><p><b>[ ${value.gameName} ] :-</b></p> <div class="select-drop-input">
                                    <div class="select-dropdown">
                                        <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                            <div class="dropdown-list s_${value.gameType} commonCls" data-class="s_${value.gameType}" data-name="${value.gameName}"  data-gameType="${value.gameType}">
    
                                            </div>
                                        </div>
                                    </div>
                                    <div class="select-input">
                                        <input type="text" id="${'totsubcnt_'+value.gameType}" readonly class="form-control">
                                    </div>
                            </div>
                        </li>`;
                        $("ul.gameColorTicketPrice").append(html);

                       

                        let allSubGame=[];
                        allSubGame = gamesData.subGames;

                        let gameobj=[];
                        for(let j=0;j<(allSubGame.length);j++){
                            if(allSubGame[j].gameType==value.gameType){
                                gameobj=allSubGame[j].ticketColorTypesNo;
                                break;
                            }
                        }

                        let totalVal=0;

                        //console.log(" reached here data ------------------ : ",gameobj)                        
                        

                        for (let i = 0; i < subGames[value.gameType].colors.length; i++) {
                            //console.log("color", subGames[value.gameType].colors[i].name)
                           
                            let colVal=0;
                            let colorflg=false;
                            for(let k=0;k<gameobj.length;k++){
                                if(gameobj[k].ticketType==subGames[value.gameType].colors[i].type){
                                    colVal=gameobj[k].ticketPrice;
                                    colorflg=true;
                                    break;
                                }
                            }
                            
                            console.log("gamesData gamesData gameobj gameobj: ",gameobj," colorflg colorflg colorflg :"+colorflg)

                            totalVal=totalVal+(colVal*1);


                            let elvisClass = "";
                            if (subGames[value.gameType].colors[i].type == "elvis1" || subGames[value.gameType].colors[i].type == "elvis2" || subGames[value.gameType].colors[i].type == "elvis3" || subGames[value.gameType].colors[i].type == "elvis4" || subGames[value.gameType].colors[i].type == "elvis5") {
                                elvisClass = "elvis_color_type";
                            }

                            let trafficLightClass = "";
                            if (subGames[value.gameType].colors[i].type == "red" || subGames[value.gameType].colors[i].type == "green" || subGames[value.gameType].colors[i].type == "yellow") {
                                trafficLightClass = "traffic_color_type";
                            }

                            // Game, Ticket Color & its Price dynamic select box options
                            let options = '';

                            options = `<label class="dropdown-option">
                                                    <input type="checkbox" class="${elvisClass} ${trafficLightClass}" name="${value.gameType}_${subGames[value.gameType].colors[i].type}" value="${subGames[value.gameType].colors[i].name}"
                                                    data-colorname="${subGames[value.gameType].colors[i].type}" data-gameName="${value.gameName}" data-gametype="${value.gameType}" ${ ((colorflg)?'checked':'') }/>
                                                    <span class="span-w-90">
                                                        ${subGames[value.gameType].colors[i].name}
                                                    </span>
                                                    <input class="bx_in" name="${value.gameType}_${subGames[value.gameType].colors[i].type}" type="text" class="w-45" value="${colVal}" required />
                                              </label>`;
                            $('.s_' + value.gameType).append(options);
                        }

                        $('#totsubcnt_'+value.gameType).val(totalVal);



                        let selectedOption = gamesSubGames[key].options;

                        for (let g = 0; g < selectedOption.length; g++) {
                            for (let i = 0; i < subGames[value.gameType].colors.length; i++) {
                                if (subGames[value.gameType].colors[i].type == selectedOption[g].ticketType) {

                                    // $('.s_' + value.gameType).filter(function(i, e) {
                                    //     // console.log("$(e).text()", $(e).toArray().map(item => {}));
                                    //     //console.log("$(e).text() == selectedOption[g].ticketName", $(e).text() == selectedOption[g].ticketName);
                                    //     //return $(e).text() == selectedOption[g].ticketName
                                    // }); //.attr("checked", "checked");

                                    let colorfind = $('.s_' + value.gameType).find('.dropdown-option dropdown-list input[value ="' + selectedOption[g].ticketName + '"]').text(); //attr("checked", "checked");
                                    console.log("colorfind", colorfind);

                                    // $('.s_' + value.gameType).toArray().map(item => {
                                    //     // let selected = item //.getAttribute("");
                                    //     // let className = item.getAttribute("data-class").children(".dropdown-option").children(".dropdown-list").attr("value");
                                    //     //let className = $('div.data-class .dropdown-option dropdown-list span.span-w-90').attr('value');
                                    //     //console.log("className", className);

                                    // });

                                }
                            }
                        }



                        // $.each($('.s_' + value.gameType), function() {
                        //     //countries.push($(this).val());
                        //     console.log("$(this).val()", $(this).text());
                        // });


                        //Game Name and Row/Pattern Prize only headings
                        createDiv(value.gameName, value.gameType, value.gameType, 's_' + value.gameType);

                        // It's check an array of object contain elivs,red,yellow,green ticket color if yes so store in one array
                        let filteredArray = subGames[value.gameType].colors.filter(item => item.type.indexOf('elvis') !== -1 || item.type.indexOf('red') !== -1 || item.type.indexOf('yellow') !== -1 || item.type.indexOf('green') !== -1);
                        console.log("filteredArray loading", filteredArray);

                        // console.log("subGames[value.gameType].colors : ",subGames[value.gameType].colors)

                        //This function do is compare two array object and remove elivs,red,yellow,green ticket colors and store smallWhite any color 
                        let checkColorsIsIn = $(subGames[value.gameType].colors).not(filteredArray).get();

                        console.log(" checkColorsIsIn checkColorsIsIn loading : ",checkColorsIsIn)

                        //If color exit's so div automatic create.
                        if (checkColorsIsIn.length > 0) {
                            let html = '<hr class="hrTag" style="border: 1px solid black;">';
                            $(".pattern_price").append(html);
                            
                            let htmlPrice = ` <div id="${value.gameType}_price_div" class="hide full-width-box tket-color-type mb-10 ${value.gameType}_price_div" >
                        <div class="row" style="width:100%">
                            <div class="col-lg-3  main_tkt_lable_ttl">
                                <ul>
                                    <li>
                                        <label data-toggle="tooltip" title="${value.gameName}"> ${value.gameName} PRICE </label>
                                    </li>
                                </ul>
                            </div>
                            <div class="col-lg-9 pd-l-5">
                                <ul class="${value.gameType}_price_ul flx-wrp"> 
                                    
                                </ul>
                            </div>
                        </div>
                    </div> 
                        <div class = "${value.gameType}_prize_div">
                        </div>`;
                        $(".s_" + value.gameType + "_price").append(htmlPrice);

                           // console.log(" subGames subGames : ",subGames)
                            
                            let subGameData = gamesData.subGames;
                            let singleSubGameOption=[];
                            let singleSubGamesData={};
                            for(let a=0;a<subGameData.length;a++){
                               if(subGameData[a].gameType==value.gameType){
                                singleSubGameOption= subGameData[a].options;
                                singleSubGamesData=subGameData[a];
                                break;
                               }  
                            }
                            console.log("  dev : ",subGameData)
                            $('#'+value.gameType+'_price_div').addClass("hide");
                            //game Name and Row/Pattern Prize input fields
                            for(let b=0;b<singleSubGameOption.length;b++){
                                if(singleSubGameOption[b].isEightColors){
                                    for(let c=0;c<((singleSubGameOption[b].winning).length);c++){
                                        console.log("++++++++++ singleSubGameOption[b] : ",singleSubGameOption[b].winning)
                                        if(c==0){
                                            $('#'+value.gameType+'_price_div').removeClass("hide");
                                        }

                                   
                                        let read="";
                                        let val = singleSubGameOption[b].winning[c].winningValue;
                                        if(singleSubGameOption[b].winning[c].isGameTypeExtra==true){
                                            read="readonly";
                                            val=0;
                                        }


                                   
                                    $("."+value.gameType + "_price_ul").append(`<li> <div class="row">
                                    <div class="col-lg-6 ">
                                        <label data-toggle="tooltip" title="${value.gameName+" "+singleSubGameOption[b].winning[c].winningPatternName}"> ${singleSubGameOption[b].winning[c].winningPatternName} </label>
                                    </div>
                                    <div class="col-lg-6 ">
                                        <input ab="888" name="${value.gameType+singleSubGameOption[b].winning[c].winningPatternType}" type="text" oval="${singleSubGameOption[b].winning[c].winningValue}" value="${val}" class="form-control" ${read} placeholder="10" required />
                                    </div></div>
                                    </li>`);
                                    }
                                    break;
                                }
                               
                            }
                            
                            console.log(" -------------------------------------- :", subGames)
                            for (let i = 0; i < subGames[value.gameType].rows.length; i++) {

                                //console.log(" subGames[value.gameType] +++++++= :",subGames[value.gameType])
                                // let options = `<li>
                                //                     <div class="row">
                                //                         <div class="col-lg-6 ">
                                //                             <label data-toggle="tooltip" title="${subGames[value.gameType].rows[i].name}"> ${subGames[value.gameType].rows[i].name} </label>
                                //                         </div>
                                //                         <div class="col-lg-6 pd-l-5">
                                //                             <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}" class="form-control" placeholder="10">
                                //                         </div>
                                //                     </div>
                                //                 </li>`;
                                // $('.' + value.gameType + '_price_ul').append(options);



                                // Game Name and Row/Pattern Prize input fields extra fields

                                // [ Mystry Game ] 
                                if (subGames[value.gameType].rows[i].isMys == true) {
                                    let extraOptions = `<div id="${value.gameType}_price_div_extra" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_extra" ><div class="row" >
                                        <div class="col-lg-3  main_tkt_lable_ttl">
                                            <ul>
                                                <li>
                                                    <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings </label>
                                                </li>
                                            </ul>
                                        </div>
                                        <div class="col-lg-9 pd-l-5">
                                            <ul class="${value.gameType}${subGames[value.gameType].rows[i].type}_price_ul flx-wrp">  
                                            </ul>
                                        </div>
                                    </div>
                                    </div>`
                                        //$('.' + value.gameType+'_price_div_extra').append( extraOptions );
                                    $('.' + value.gameType + '_prize_div').append(extraOptions)
                                    console.log("subGames[value.gameType].rows[i].name", subGames[value.gameType].rows[i].type)
                                    for (let k = 1; k <= 5; k++) {
                                        let num = "th"
                                        if (k == 1) {
                                            num = "st"
                                        } else if (k == 2) {
                                            num = "nd"
                                        } else if (k == 3) {
                                            num = "rd"
                                        }
                                        let options = `  <li> <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${k}${num} Prize">${k}${num} Prize</label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input ab="777" type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}Prize${k}" class="form-control" placeholder="10" required>
                                                            </div></div>
                                                        </li>  `
                                        $('.' + value.gameType + subGames[value.gameType].rows[i].type + '_price_ul').append(options);
                                    }
                                }

                                // [ Treasure Chest Game ]
                                if (subGames[value.gameType].rows[i].isTchest == true) {
                                    let extraOptions = `<div id="${value.gameType}_price_div_isTchest" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_isTchest" >
                                                        <div class="row">
                                                            <div class="col-lg-3  main_tkt_lable_ttl">
                                                                <ul>
                                                                    <li>
                                                                        <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings </label>
                                                                    </li>
                                                                </ul>
                                                            </div>
                                                            <div class="col-lg-9 pd-l-5">
                                                                <ul class="${value.gameType}${subGames[value.gameType].rows[i].type}_price_ul_isTchest flx-wrp">  
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    </div>`
                                        //$('.' + value.gameType+'_price_div_extra').append( extraOptions );
                                    $('.' + value.gameType + '_prize_div').append(extraOptions);
                                    for (let k = 1; k <= 12; k++) {
                                        let num = "th"
                                        if (k == 1) {
                                            num = "st"
                                        } else if (k == 2) {
                                            num = "nd"
                                        } else if (k == 3) {
                                            num = "rd"
                                        }
                                        let options = `  <li> <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${k}${num} Prize">${k}${num} Prize</label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input ab="666" type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}isTchest${k}" class="form-control" placeholder="10" required />
                                                            </div></div>
                                                        </li>  `
                                        $('.' + value.gameType + subGames[value.gameType].rows[i].type + '_price_ul_isTchest').append(options);
                                    }

                                }

                            }


                            console.log(" singleSubGamesData  : ",singleSubGamesData.options)

                            for(let co=0;co<((singleSubGamesData.options).length);co++){
                                if(!(singleSubGamesData.options[co].isEightColors)){
                                   console.log("singleSubGamesData.options[co] : ",singleSubGamesData.options[co])
                                    let htm=`<div id="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_div"}" class="full-width-box tket-color-type mb-10 ${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_div"}">
                                                <div class="row" style="width:100%">
                                                    <div class="col-lg-3  main_tkt_lable_ttl">
                                                        <ul>
                                                            <li>
                                                                <label data-toggle="tooltip" title="${value.gameName+"_"+singleSubGamesData.options[co].ticketName}"> ${value.gameName+" "+singleSubGamesData.options[co].ticketName+" Price"} </label>
                                                            </li>
                                                        </ul>
                                                    </div>
                                                    <div class="col-lg-9 pd-l-5">
                                                        <ul class="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_ul"} flx-wrp">`; 
                                                            
                                                            for(let op=0;op<((singleSubGamesData.options[co].winning).length);op++){
                                                               console.log(" cccccccccccccccccccccc :",singleSubGamesData.options[co].winning[op].isGameTypeExtra)
                                                               let read="readonly";
                                                                let val = 0;
                                                                if(singleSubGamesData.options[co].winning[op].isGameTypeExtra==false){
                                                                    read="";
                                                                    val=singleSubGamesData.options[co].winning[op].winningValue;
                                                                }
                                                               
                                                               htm=htm+`<li> 
                                                                    <div class="row">
                                                                        <div class="col-lg-6 pd-r-5">
                                                                            <label data-toggle="tooltip" title="${value.gameName+" "+singleSubGamesData.options[co].winning[op].winningPatternName} "> ${singleSubGamesData.options[co].winning[op].winningPatternName} </label>
                                                                        </div>
                                                                        <div class="col-lg-6 pd-l-5">
                                                                            <input ${read} type="text" name="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+singleSubGamesData.options[co].winning[op].winningPatternType}" value="${val}" oval="${singleSubGamesData.options[co].winning[op].winningValue}" class="form-control" placeholder="10" required />
                                                                        </div>
                                                                    </div>
                                                                </li>`;
                                                            }
                                                            
                                                        htm =htm+`</ul>
                                                    </div>
                                                </div>
                                            </div>`;

                                    $('#s_'+value.gameType+'_price').append(htm);
                                    //console("single colors colors : ",htm)
                                }

                            }
                            console.log("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbb : ",gamesData.trafficLightExtraOptions) //trafficLightExtraOptions
                            for(let k=0;k<(gamesData.trafficLightExtraOptions).length;k++){
                                if(gamesData.trafficLightExtraOptions[k].gameType==value.gameType){
                                    //console.log("+++++++++++++++ trafficLightExtraOptions : ",gamesData.trafficLightExtraOptions)
                                        let keyId=gamesData.trafficLightExtraOptions[k].type; 
                                        let sst = keyId.split(gamesData.trafficLightExtraOptions[k].gameType);

                                        console.log("  log ++++++++++++  : ",gamesData.trafficLightExtraOptions[k].winning)

                                        //console.log(" subGames[newGameType] : ",subGames[newGameType])

                                        let colorId = sst[1];
                                        let ht=`<div id="${value.gameType+((gamesData.trafficLightExtraOptions.length>2)?'_threeSameRow_price_div_extra':'_twoSameRow_price_div_extra')}" class="full-width-box tket-color-type mb-10 ${value.gameType+((gamesData.trafficLightExtraOptions.length>2)?'_threeSameRow_price_div_extra':'_twoSameRow_price_div_extra')}">
                                            <input type="hidden" name="${value.gameType+'_twoSameRow'+colorId}" value="true">
                                            <div class="row" style="width:100%;">
                                                <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                                    <ul>
                                                        <li>
                                                            <label data-toggle="tooltip" title="${value.gameName+' Same 2 Colors '+colorId}"> ${value.gameName+' Same 2 Colors '+colorId} </label>
                                                        </li>
                                                    </ul>
                                                </div>
                                                <div class="col-lg-9 pd-l-5">
                                                    <ul class="${value.gameType+colorId+'_price_ul'} flx-wrp">`;  
                                                        for(let w=0;w<((gamesData.trafficLightExtraOptions[k].winning).length);w++)
                                                        {
                                                            //console.log(" gamesData.trafficLightExtraOptions[k].winning[w] :",gamesData.trafficLightExtraOptions[k].winning)

                                                            ht=ht+`<li>`; 
                                                            for(let ke in gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey])
                                                            {
                                                                let read="";
                                                                let val = gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey][ke];

                                                               // console.log("bbbbbbbbbbbbbbbbbbbbbbbbbAAAAAAAAAAA : ",value)

                                                                if(gamesData.trafficLightExtraOptions[k].winning[w].isGameTypeExtra==true){
                                                                    read="readonly";
                                                                    val=0;
                                                                }

                                                                ht=ht+`<div class="row">
                                                                            <div class="col-lg-6 pd-r-5">
                                                                                <label data-toggle="tooltip" title="${value.gameName +(' '+ke.charAt(0).toUpperCase() + ke.slice(1))+" Row"+(1*w+1)}"> ${(ke.charAt(0).toUpperCase() + ke.slice(1))+" "+gamesData.trafficLightExtraOptions[k].winning[w].rowName} </label>
                                                                            </div>
                                                                            <div class="col-lg-6 pd-l-5">
                                                                                <input ${read} am11="444" type="text" name="${value.gameType+colorId+'_'+(ke.charAt(0).toUpperCase() + ke.slice(1))+'_'+(gamesData.trafficLightExtraOptions[k].winning[w].rowKey)}" value="${val}"   oval ="${gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey][ke]}" class="form-control" placeholder="10" required />
                                                                            </div>
                                                                        </div>`;
                                                            }        

                                                
                                                                    // <div class="row">
                                                                    //     <div class="col-lg-6 pd-r-5">
                                                                    //         <label data-toggle="tooltip" title="Sub Game Elvis Yellow Row 1"> Yellow Row 1 </label>
                                                                    //     </div>
                                                                    //     <div class="col-lg-6 pd-l-5">
                                                                    //         <input type="text" name="sub_game_elvis_Red_Yellow_Yellow_row1" class="form-control" placeholder="10">
                                                                    //     </div>
                                                                    // </div>

                                                            ht=ht+`</li> `;
                                                        }

                                                    ht = ht+`</ul>
                                                </div>
                                            </div>
                                        </div>`;

                                        $('#s_'+value.gameType+'_price').append(ht);
                                    }
                            }

                            
                            console.log("------------------------------------- aaaaaaaaaaaa :",subGameData)
                            for(let ob=0;ob<subGameData.length;ob++){
                                for(let am=0;am<(subGameData[ob].options).length;am++){
                                   
                                    if(am==0){
                                        
                                        for(let lo=0;lo<((subGameData[ob].options[am].winning).length);lo++){

                                            if(subGameData[ob].options[am].winning[lo].isTchest){
                                                let cnt=1;
                                                for(key in subGameData[ob].options[am].winning[lo].extraWinningsTchest)
                                                {

                                                    $(`input[name="${subGameData[ob].gameType+subGameData[ob].options[am].winning[lo].winningPatternType+'isTchest'+cnt}"]`).val(subGameData[ob].options[am].winning[lo].extraWinningsTchest[key]);

                                                   // console.log(" arvind array  ------------------ : ",subGameData[ob])

                                                    cnt++;
                                                }
                                            }
                                            if(subGameData[ob].options[am].winning[lo].isMys){
                                                let ct=1;
                                                for(key in subGameData[ob].options[am].winning[lo].extraWinnings)
                                                {
                                                    $(`input[name="${subGameData[ob].gameType+subGameData[ob].options[am].winning[lo].winningPatternType+'Prize'+ct}"]`).val(subGameData[ob].options[am].winning[lo].extraWinnings[key]);
                                                    //console.log("mystroy ++++++++ : "+subGameData[ob].gameType+subGameData[ob].options[am].winning[lo].winningPatternType+key)
                                                    //console.log(" arvind array : ",subGameData[ob].gameType+subGameData[ob].options[am].winning[lo].winningPatternType+'Prize'+ct)
                                                    //console.log(" arvind array : ",subGameData[ob].options[am].winning[lo].winningPatternType+'Prize'+ct)
                                                    //console.log(" arvind array  mystory : ",subGameData[ob].options[am])
                                                    ct++;
                                                }
                                            }
                                        }
                                        break;
                                    }
                                }
                            }

                        }else{

                            let subGameData = gamesData.subGames;
                            let singleSubGameOption=[];
                            let singleSubGamesData={};
                            for(let a=0;a<subGameData.length;a++){
                               if(subGameData[a].gameType==value.gameType){
                                singleSubGameOption= subGameData[a].options;
                                singleSubGamesData=subGameData[a];
                                break;
                               }  
                            }

                            console.log(" singleSubGamesData else else else  : ",singleSubGamesData.options)

                            for(let co=0;co<((singleSubGamesData.options).length);co++){
                                if(!(singleSubGamesData.options[co].isEightColors)){
                                   // console.log("singleSubGamesData.options[co] : ",singleSubGamesData.options[co])
                                    let htm=`<div id="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_div"}" class="full-width-box tket-color-type mb-10 ${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_div"}">
                                                <div class="row" style="width:100%;">
                                                    <div class="col-lg-3  main_tkt_lable_ttl">
                                                        <ul>
                                                            <li>
                                                                <label data-toggle="tooltip" title="${value.gameName+"_"+singleSubGamesData.options[co].ticketName}"> ${value.gameName+" "+singleSubGamesData.options[co].ticketName+" Price"} </label>
                                                            </li>
                                                        </ul>
                                                    </div>
                                                    <div class="col-lg-9 pd-l-5">
                                                        <ul class="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+"_price_ul"} flx-wrp">`; 
                                                            
                                                            for(let op=0;op<((singleSubGamesData.options[co].winning).length);op++){
                                                               //console.log("1111111111111111111111111 :",singleSubGamesData.options[co].winning[op])
                                                                let read="";
                                                                let val = singleSubGamesData.options[co].winning[op].winningValue;
                                                                if(singleSubGamesData.options[co].winning[op].isGameTypeExtra==true){
                                                                    read="readonly";
                                                                    val=0;
                                                                }
                                                               
                                                               htm=htm+`<li> 
                                                                    <div class="row">
                                                                        <div class="col-lg-6 pd-r-5">
                                                                            <label data-toggle="tooltip" title="${value.gameName+" "+singleSubGamesData.options[co].winning[op].winningPatternName} "> ${singleSubGamesData.options[co].winning[op].winningPatternName} </label>
                                                                        </div>
                                                                        <div class="col-lg-6 pd-l-5">
                                                                            <input ab="111" ${read}  type="text" name="${value.gameType+"_"+singleSubGamesData.options[co].ticketType+singleSubGamesData.options[co].winning[op].winningPatternType}" value="${val}" oval="${singleSubGamesData.options[co].winning[op].winningValue}" class="form-control" placeholder="10" required />
                                                                        </div>
                                                                    </div>
                                                                </li>`;
                                                            }
                                                            
                                                        htm =htm+`</ul>
                                                    </div>
                                                </div>
                                            </div>`;

                                    $('#s_'+value.gameType+'_price').append(htm);
                                    //console("single colors colors : ",htm)
                                }

                            } 
                            //console.log(" LOADING : ",gamesData.trafficLightExtraOptions)
                            console.log(" value.gameType value.gameType  : "+value.gameType)

                            for(let k=0;k<(gamesData.trafficLightExtraOptions).length;k++){
                                if(gamesData.trafficLightExtraOptions[k].gameType==value.gameType){
                                    console.log("+++++++++++++++ trafficLightExtraOptions : ",gamesData.trafficLightExtraOptions[k].winning)

                                        let keyId=gamesData.trafficLightExtraOptions[k].type; 
                                        let sst = keyId.split(gamesData.trafficLightExtraOptions[k].gameType);
                                        //console.log("  log  : ",gamesData.trafficLightExtraOptions[k])
                                        console.log(" sst sst sst sst : ",sst)
                                        let colorId = sst[1];
                                        let ht=`<div id="${value.gameType+((gamesData.trafficLightExtraOptions.length>2)?'_threeSameRow_price_div_extra':'_twoSameRow_price_div_extra')}" class="full-width-box tket-color-type mb-10 ${value.gameType+((gamesData.trafficLightExtraOptions.length>2)?'_threeSameRow_price_div_extra':'_twoSameRow_price_div_extra')}">
                                            <input type="hidden" name="${value.gameType+((gamesData.trafficLightExtraOptions.length>2)?'_threeSameRow':'_twoSameRow')+colorId}" value="true">
                                            <div class="row" style="width:100%;">
                                                <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                                    <ul>
                                                        <li>
                                                            <label data-toggle="tooltip" title="${value.gameName+' Same 2 Colors '+colorId}"> ${value.gameName+' Same 2 Colors '+colorId} </label>
                                                        </li>
                                                    </ul>
                                                </div>
                                                <div class="col-lg-9 pd-l-5">
                                                    <ul class="${value.gameType+colorId+'_price_ul'} flx-wrp">`;  
                                                        for(let w=0;w<((gamesData.trafficLightExtraOptions[k].winning).length);w++)
                                                        {
                                                            console.log(" gamesData.trafficLightExtraOptions[k].winning[w] :",gamesData.trafficLightExtraOptions[k])

                                                            ht=ht+`<li>`; 
                                                            for(let ke in gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey])
                                                            {
                                                                console.log("+++++++++++++++++++++ke++++++++++ke+++++++++++ : ",gamesData.trafficLightExtraOptions[k].winning[w])
                                                                let read="";
                                                                let val = gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey][ke];
                                                                if(gamesData.trafficLightExtraOptions[k].winning[w].isGameTypeExtra==true){
                                                                    read="readonly";
                                                                    val=0;
                                                                }

                                                                ht=ht+`<div class="row">
                                                                            <div class="col-lg-6 pd-r-5">
                                                                                <label data-toggle="tooltip" title="${value.gameName +(' '+ke.charAt(0).toUpperCase() + ke.slice(1))+" Row"+(1*w+1)}"> ${(ke.charAt(0).toUpperCase() + ke.slice(1))+" "+gamesData.trafficLightExtraOptions[k].winning[w].rowName } </label>
                                                                            </div>
                                                                            <div class="col-lg-6 pd-l-5">
                                                                                <input ${read} type="text" name="${value.gameType+colorId+'_'+(ke.charAt(0).toUpperCase() + ke.slice(1))+'_'+(gamesData.trafficLightExtraOptions[k].winning[w].rowKey)}" value="${val}"  oval ="${gamesData.trafficLightExtraOptions[k].winning[w][gamesData.trafficLightExtraOptions[k].winning[w].rowKey][ke]}" class="form-control" placeholder="10" required />
                                                                            </div>
                                                                        </div>`;
                                                            }        

                                                
                                                                    // <div class="row">
                                                                    //     <div class="col-lg-6 pd-r-5">
                                                                    //         <label data-toggle="tooltip" title="Sub Game Elvis Yellow Row 1"> Yellow Row 1 </label>
                                                                    //     </div>
                                                                    //     <div class="col-lg-6 pd-l-5">
                                                                    //         <input type="text" name="sub_game_elvis_Red_Yellow_Yellow_row1" class="form-control" placeholder="10">
                                                                    //     </div>
                                                                    // </div>

                                                            ht=ht+`</li> `;
                                                        }

                                                    ht = ht+`</ul>
                                                </div>
                                            </div>
                                        </div>`;

                                        $('#s_'+value.gameType+'_price').append(ht);
                                    }
                            }

                        }

                    }
                }
            });

           

            function createDiv(Title, name, id, colorDivId) {
                console.log("AAAAAAAAAAAAAAAAAAAAAAA title :", Title," : ", name," : ", id," : ", colorDivId)
                
                let allSubGame=[];
                allSubGame = gamesData.subGames;

                let gameobjcolors=[];
                let gameJackpotPrice = {};
                for(let j=0;j<(allSubGame.length);j++){
                    if(allSubGame[j].gameType==id){
                        gameobjcolors=allSubGame[j].ticketColorTypesNo;
                        gameJackpotPrice = allSubGame[j].jackpotValues;
                        break;
                    }
                }

                console.log("createDiv createDiv allSubGame allSubGame : ",gameobjcolors)

                let jackpotPriceDrawsHtml = `
            <div id="jackpotPriceDraws${id}" class="col-lg-4">
                <div class="row mb-10">
                    <div  class="col-lg-4 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `">` + Title + `</label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-8 pd-l-5">
                        <ul>
                            <li>
                                <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <input type="text" name= "jackpotPrice${name}" value="${gameJackpotPrice.price}" class="form-control" placeholder="10000" required />
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name= "jackpotDraws${name}" value="${gameJackpotPrice.draw}" class="form-control" placeholder="51" required />
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>    `
                $(".jackpotPriceDraws").append(jackpotPriceDrawsHtml)

               // let 

                $(".color_pr").append(`<div id="${colorDivId}_color"  class="${colorDivId}_color">
            <div class="full-width-box tket-color-type mb-10 ${colorDivId}_color_div" style="`+((gameobjcolors.length>0)?'display:block':'display:none')+`">
                <div class="row">
                    <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `"> ` + Title + ` </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-9 pd-l-5">
                        <ul class="${colorDivId}_color_ul" style="display:block !important;"> </ul>
                    </div>
                </div>
            </div>  
        </div>`);

                $(".pattern_price").append(`<div id="${colorDivId}_price"  class="${colorDivId}_price">
            
        </div>`);

            for(i=0;i<gameobjcolors.length;i++){
                

                let html = `<div class="col-md-4"><li id= "${id+'_'+gameobjcolors[i].ticketType}"> <div class="row">
                <div class="col-lg-6 pd-r-5">
                    <label data-toggle="tooltip" title="` + (gameobjcolors[i].ticketName) + `">` + (gameobjcolors[i].ticketName) + `</label>
                </div>
                <div class="col-lg-6 pd-l-5">
                    <input ab="333" type="text" name="${id+'_'+gameobjcolors[i].ticketType}Color" class="form-control" value="${gameobjcolors[i].ticketCount}" placeholder="10" required />
                </div>
                </div></li></div>`;
                $('ul.' + colorDivId + '_color_ul').append(html);
               // console.log(" ul li list : ",html)   
            }
     

            }

            let existingItems = $.map($('.gameColorTicketPrice > li'), li => li.id);
            idName.sort
            existingItems.sort
            let tempIdName = idName.map(item => item.gameType)
            let diff = $(existingItems).not(tempIdName).get();
            console.log(" reached here : ",diff)
            $.each(diff, function(key, value) {
                $('#' + value).remove();
                $('#jackpotPriceDraws' + value).remove();
                $('#s_' + value + '_color').remove();
                $('#s_' + value + '_price').remove();
                $('.hrTag').remove();
            });

            $('.js-select2').select2({
                closeOnSelect: false,
                placeholder: "Elvis",
                allowHtml: true,
                allowClear: true,
                tags: true
            });

            $('.js-select5').select2({
                closeOnSelect: false,
                placeholder: "Traffic Light",
                allowHtml: true,
                allowClear: true,
                tags: true
            });

            var checkboxesDropdowns = document.querySelectorAll('[data-control="checkbox-dropdown"]');

            for (var i = 0, length = checkboxesDropdowns.length; i < length; i++) {
                new CheckboxDropdown(checkboxesDropdowns[i]);
            }

        }
    });

    $("#gameNameSelect").on('change', function() {
        //["elvis", "mystery", "1_3_5", "traffic_light", "tv_extra", "jackpot", "innstanten", "oddsen", "lykkehjulet", "spillernes_spill", "kvikkis_full_bong", "super_nils", "1000_spills", "fargekladden", "skattekisten", "ball_x_10", "500_spills", "500_x_5", "extra", "jocker", "2500_in_full", "4000_in_full", "finale"]

        let idName = $('#gameNameSelect option:selected').toArray().map(item => {
            let newObj = {};
            let be = item.value;
            let fields = be.split('|');
            newObj["gameName"] = fields[1];
            newObj["gameType"] = fields[2];
            return newObj;
        });


        console.log("sub game name +++++++++++++++++++++++ : ", idName)

        if (idName.length > 1) {
            let html = '<hr class="hrTag" style="border: 1px solid black;">';
            $(".pattern_price").append(html);
        }

        $.each(idName, function(key, value) {
            if (!$("#" + value.gameType).length) {
                if (subGames[value.gameType]) {
                    console.log("values", subGames[value.gameType])

                    // Game, Ticket Color & its Price 
                    let html = `
                    <li id= "${value.gameType}" class="${value.gameType} col-lg-4"><p><b>[ ${value.gameName} ] :-</b></p> <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                    <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_${value.gameType} commonCls" data-class="s_${value.gameType}" data-name="${value.gameName}" data-gameType="${value.gameType}">
 
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    for (let i = 0; i < subGames[value.gameType].colors.length; i++) {
                        //console.log("color", subGames[value.gameType].colors[i].name)
                        let elvisClass = "";
                        if (subGames[value.gameType].colors[i].type == "elvis1" || subGames[value.gameType].colors[i].type == "elvis2" || subGames[value.gameType].colors[i].type == "elvis3" || subGames[value.gameType].colors[i].type == "elvis4" || subGames[value.gameType].colors[i].type == "elvis5") {
                            elvisClass = "elvis_color_type"
                        }
                        let trafficLightClass = "";
                        if (subGames[value.gameType].colors[i].type == "red" || subGames[value.gameType].colors[i].type == "green" || subGames[value.gameType].colors[i].type == "yellow") {
                            trafficLightClass = "traffic_color_type"
                        }
                        // // Game, Ticket Color & its Price dynamic select box options
                        let options = `<label class="dropdown-option">
                                                <input type="checkbox" class="${elvisClass} ${trafficLightClass}" name="${value.gameType}_${subGames[value.gameType].colors[i].type}" value="${subGames[value.gameType].colors[i].name}"
                                                data-colorname="${subGames[value.gameType].colors[i].type}"    data-gameName="${value.gameName}" data-gametype="${value.gameType}"/>
                                                <span class="span-w-90  ">
                                            ${subGames[value.gameType].colors[i].name}</span><input class="bx_in" name="${value.gameType}_${subGames[value.gameType].colors[i].type}" type="text" class="w-45" value="0"/>
                                        </label>`
                        $('.s_' + value.gameType).append(options);
                    }

                    //Game Name and Row/Pattern Prize only headings
                    createDiv(value.gameName, value.gameType, value.gameType, 's_' + value.gameType);

                    // It's check an array of object contain elivs,red,yellow,green ticket color if yes so store in one array
                    let filteredArray = subGames[value.gameType].colors.filter(item => item.type.indexOf('elvis') !== -1 || item.type.indexOf('red') !== -1 || item.type.indexOf('yellow') !== -1 || item.type.indexOf('green') !== -1);
                    //console.log("filteredArray changed", filteredArray);

                    // console.log("subGames[value.gameType].colors : ",subGames[value.gameType].colors)

                    //This function do is compare two array object and remove elivs,red,yellow,green ticket colors and store smallWhite any color 
                    let checkColorsIsIn = $(subGames[value.gameType].colors).not(filteredArray).get();

                    //console.log(" changed after data : ",checkColorsIsIn)

                    //If color exit's so div automatic create.
                    if (checkColorsIsIn.length > 0) {
                        let htmlPrice = ` <div id="${value.gameType}_price_div" class="hide full-width-box tket-color-type mb-10 ${value.gameType}_price_div" >
                        <div class="row" >
                            <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                <ul>
                                    <li>
                                        <label data-toggle="tooltip" title="${value.gameName}"> ${value.gameName} PRICE </label>
                                    </li>
                                </ul>
                            </div>
                            <div class="col-lg-9 pd-l-5">
                                <ul class="${value.gameType}_price_ul flx-wrp"> 
                        
                                </ul>
                            </div>
                        </div>
                    </div> 
                    <div class = "${value.gameType}_prize_div">
                        </div>`;
                        $(".s_" + value.gameType + "_price").append(htmlPrice);

                        //game Name and Row/Pattern Prize input fields
                       // console.log(" subGames[value.gameType] subGames[value.gameType] :", subGames[value.gameType])
                        for (let i = 0; i < subGames[value.gameType].rows.length; i++) {

                            console.log(" subGames[value.gameType] +++++++++++ : ",subGames[value.gameType])
                            // let options = `<li>
                            //                     <div class="row">
                            //                         <div class="col-lg-6 pd-r-5">
                            //                             <label data-toggle="tooltip" title="${subGames[value.gameType].rows[i].name}"> ${subGames[value.gameType].rows[i].name} </label>
                            //                         </div>
                            //                         <div class="col-lg-6 pd-l-5">
                            //                             <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}" class="form-control" placeholder="10">
                            //                         </div>
                            //                     </div>
                            //                 </li>`;
                            // $('.' + value.gameType + '_price_ul').append(options);

                            // Game Name and Row/Pattern Prize input fields extra fields

                            // [ Mystry Game ] 
                            if (subGames[value.gameType].rows[i].isMys == true) {
                                let extraOptions = `<div id="${value.gameType}_price_div_extra" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_extra" ><div class="row">
                                        <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                            <ul>
                                                <li>
                                                    <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings </label>
                                                </li>
                                            </ul>
                                        </div>
                                        <div class="col-lg-9 pd-l-5">
                                            <ul class="${value.gameType}${subGames[value.gameType].rows[i].type}_price_ul flx-wrp">  
                                            </ul>
                                        </div>
                                    </div>
                                    </div>`
                                    //$('.' + value.gameType+'_price_div_extra').append( extraOptions );
                                $('.' + value.gameType + '_prize_div').append(extraOptions)
                                console.log("subGames[value.gameType].rows[i].name", subGames[value.gameType].rows[i].type)
                                for (let k = 1; k <= 5; k++) {
                                    let num = "th"
                                    if (k == 1) {
                                        num = "st"
                                    } else if (k == 2) {
                                        num = "nd"
                                    } else if (k == 3) {
                                        num = "rd"
                                    }
                                    let options = `  <li> <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${k}${num} Prize">${k}${num} Prize</label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}Prize${k}" class="form-control" placeholder="10" required>
                                                            </div></div>
                                                        </li>  `
                                    $('.' + value.gameType + subGames[value.gameType].rows[i].type + '_price_ul').append(options);
                                }
                            }

                            // [ Treasure Chest Game ]
                            if (subGames[value.gameType].rows[i].isTchest == true) {
                                let extraOptions = `<div id="${value.gameType}_price_div_isTchest" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_isTchest" >
                                                        <div class="row">
                                                            <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                                                <ul>
                                                                    <li>
                                                                        <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings </label>
                                                                    </li>
                                                                </ul>
                                                            </div>
                                                            <div class="col-lg-9 pd-l-5">
                                                                <ul class="${value.gameType}${subGames[value.gameType].rows[i].type}_price_ul_isTchest flx-wrp">  
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    </div>`
                                    //$('.' + value.gameType+'_price_div_extra').append( extraOptions );
                                $('.' + value.gameType + '_prize_div').append(extraOptions);
                                for (let k = 1; k <= 12; k++) {
                                    let num = "th"
                                    if (k == 1) {
                                        num = "st"
                                    } else if (k == 2) {
                                        num = "nd"
                                    } else if (k == 3) {
                                        num = "rd"
                                    }
                                    let options = `  <li> <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${k}${num} Prize">${k}${num} Prize</label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}isTchest${k}" class="form-control" placeholder="10" required>
                                                            </div></div>
                                                        </li>  `
                                    $('.' + value.gameType + subGames[value.gameType].rows[i].type + '_price_ul_isTchest').append(options);
                                }

                            }

                        }

                        


                    }
                }
            }
        });

        function createDiv(Title, name, id, colorDivId) {
            console.log("title", Title, name, id, colorDivId)

            let jackpotPriceDrawsHtml = `
            <div id="jackpotPriceDraws${id}" class="col-lg-4">
                <div class="row mb-10">
                    <div  class="col-lg-4 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `">` + Title + `</label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-8 pd-l-5">
                        <ul>
                            <li>
                                <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <input type="text" name= "jackpotPrice${name}" class="form-control" placeholder="10000" required />
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name= "jackpotDraws${name}" class="form-control" placeholder="51" required />
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>    `
            $(".jackpotPriceDraws").append(jackpotPriceDrawsHtml)

            $(".color_pr").append(`<div id="${colorDivId}_color"  class="${colorDivId}_color">
            <div class="full-width-box tket-color-type mb-10 ${colorDivId}_color_div" style="display: none">
                <div class="row" >
                    <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `"> ` + Title + ` </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-9 pd-l-5">
                        <ul class="${colorDivId}_color_ul">   
                        </ul>
                    </div>
                </div>
            </div>  
        </div>`);
            
            $(".pattern_price").append(`<div id="${colorDivId}_price"  class="${colorDivId}_price">
            
        </div>`);


        }

        let existingItems = $.map($('.gameColorTicketPrice > li'), li => li.id);
        idName.sort
        existingItems.sort
        let tempIdName = idName.map(item => item.gameType)
        let diff = $(existingItems).not(tempIdName).get();
        $.each(diff, function(key, value) {
            $('#' + value).remove();
            $('#jackpotPriceDraws' + value).remove();
            $('#s_' + value + '_color').remove();
            $('#s_' + value + '_price').remove();
            $('.hrTag').remove();
        });

        $('.js-select2').select2({
            closeOnSelect: false,
            placeholder: "Elvis",
            allowHtml: true,
            allowClear: true,
            tags: true
        });
        $('.js-select5').select2({
            closeOnSelect: false,
            placeholder: "Traffic Light",
            allowHtml: true,
            allowClear: true,
            tags: true
        });
        var checkboxesDropdowns = document.querySelectorAll('[data-control="checkbox-dropdown"]');
        for (var i = 0, length = checkboxesDropdowns.length; i < length; i++) {
            new CheckboxDropdown(checkboxesDropdowns[i]);
        }
    });

    $(document).on("change", ".dropdown_box input[type='checkbox']", function() {
        let className = $(this).parent('.dropdown-option').parent('.dropdown-list').attr('data-class');
        // console.log("checked", className);
        //if (className == "s_mystery" || className == "s_1_3_5" || className == "s_tv_extra" || className == "s_jackpot" || className == "s_innstanten" || className == "s_oddsen" || className == "s_lykkehjulet" || className == "s_spillernes_spill" || className == "s_kvikkis_full_bong" || className == "s_super_nils" || className == "s_1000_spills" || className == "s_fargekladden" || className == "s_skattekisten" || className == "s_ball_x_10" || className == "s_500_spills" || className == "s_500_x_5" || className == "s_extra" || className == "s_jocker" || className == "s_2500_in_full" || className == "s_4000_in_full" || className == "s_finale") {

        console.log("++++++++++++++++++ dropdown checked :");

        let gametype=$(this).parent('.dropdown-option').parent('.dropdown-list').attr('data-gameType');

        let idName = $('.' + className + ' input:checked').toArray().map(item => {
            console.log("item", item);
            //gametype = item.getAttribute('data-gametype');;
            let newObj = {};
            newObj["name"] = item.name;
            newObj["value"] = item.value;
            newObj["colorName"] = item.getAttribute('data-colorname');
            newObj["gameName"] = item.getAttribute('data-gamename');
            newObj["typeOfGame"] = item.getAttribute('data-gametype');
            return newObj;
        });

        console.log(" idName changing ++++++++++++++++ : "+gametype+" idName idName ::: ",idName);

        // Add 8 colors of single input

        let ecflag = false;
        for (let cols = 0; cols < (idName.length); cols++) {
            let cname = idName[cols].value;
            let ind = ETICKETCOLORS.findIndex(row => row == cname);
            if (ind >= 0) {
                ecflag = true;
                break;
            }
        }
        
        if (!ecflag) {
            $('.' + gametype + '_price_ul li').remove();
            $('#' + gametype + '_price_div').addClass('hide');

        } else {
            //console.log(" subGames subGames subGames :" + $('.' + gametype + '_price_ul li').length)
            console.log(" subGames subGames changing : ",subGames, " gametype gametype :"+gametype)
            if ($('.' + gametype + '_price_ul li').length == '0') {
                for (let i = 0; i < subGames[gametype].rows.length; i++) {
                    let options = ` <li> <div class="row">
                                        <div class="col-lg-6 pd-r-5">
                                            <label data-toggle="tooltip" title="${gametype} ${subGames[gametype].rows[i].name}"> ${subGames[gametype].rows[i].name} </label>
                                        </div>
                                        <div class="col-lg-6 pd-l-5">
                                            
                                            <input type="text" value="" name="${gametype}${subGames[gametype].rows[i].type}" class="form-control" placeholder="10" required>
                                        </div></div>
                                    </li> `
                    $('.' + gametype + '_price_ul').append(options);
                }

                $('#' + gametype + '_price_div').removeClass('hide');
            }
        }

        console.log("++++++++++++++++++++++++++++AAAAAAAAAAAAAAAAC : " + ecflag)

        // for(cols of ETICKETCOLORS){
        //     //console.log(" colors : "+ cols)
        //     var ob = idName.find(row=>row.value==cols);



        //     // if(ob.length>0){
        //     //     console.log(" ob return : ",ob)
        //     //     break;
        //     // }
        // }

        let colorId = "#" + className + "_color";

        //Generate Number of tickets for ticket color/type tickets count header
        if (!$(colorId).length) {
            let colorDivname = $("." + className).attr('data-name');
            //console.log("colorDivname", colorDivname)
            $(".color_pr").append(`<div id="${className}_color"  class="${className}_color">
                <div class="full-width-box tket-color-type mb-10 ${className}_color_div" style="display: none">
                    <div class="row" >
                        <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label data-toggle="tooltip" title="` + colorDivname + `" > ` + colorDivname + ` </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-9 pd-l-5">
                            <ul class="${className}_color_ul flx-wrp">   
                            </ul>
                        </div>
                    </div>
                </div>  
            </div>`);
        }

        if (idName.length == 0) {
            $('.' + className + '_color_div').css("display", "none");
            //$(colorId).remove();
        }
        // Get the existing elements from test div
        let existingItems = $.map($('.' + className + '_color_ul').find("li"), li => li.id);
        console.log("existing item changing ", existingItems)
        // Check if elements exists - if not - add element

        $.each(idName, function(key, val) {

            //console.log("before options", val.id, $("#"+val.id.replace(/\s/g, '')).length)
            if (!$("#" + val.name.replace(/\s/g, '')).length) {
                //console.log("idName colors", val.value, val.name)
                // Item does not exist - add
                //if(value == "elvisColorOptions1" || value == "elvisColorOptions2"  || value == "elvisColorOptions3"  || value == "elvisColorOptions4"  || value == "elvisColorOptions5" )
                //{
                $('.' + className + '_color_div').css("display", "block")
                    //Generate Number of tickets for ticket color/type tickets count dynamic input fields
                let html = `<div class="col-md-4"><li id= "${val.name.replace(/\s/g, '')}"> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label data-toggle="tooltip" title="` + (val.value) + `">` + (val.value) + `</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${val.name}Color" class="form-control" placeholder="10" required />
                                    </div>
                                </div></li> </div>`;
                $('ul.' + className + '_color_ul').append(html);
                //}

            }
        });

        // In This Condition check if elvis red,yellow and green exits and store in array..!!

        // [ Old working but not proper ]
        // let resultsKeyword = idName.filter(object => Object.values(object).some(i =>
        //     //console.log("i", i)
        //     i.includes('elvis') ? true : i.includes('red') ? true : i.includes('yellow') ? true : i.includes('green') ? true : false
        // ));

        // [ Split if elvis , red , yellow , green ]
        let resultsKeyword = idName.filter(object =>
            object.colorName.includes('elvis') ? true : object.colorName.includes('red') ? true : object.colorName.includes('yellow') ? true : object.colorName.includes('green') ? true : false
        );

       // console.log("resultsKeyword change", resultsKeyword);

        let twoSameRow = false;
        let threeSameRow = false;
        let colorCombiniation = '';
        let ulClassColorCombiniation = '';

        if (resultsKeyword.some(vendor => vendor['value'] === 'Red') && resultsKeyword.some(vendor => vendor['value'] === 'Yellow') && resultsKeyword.some(vendor => vendor['value'] === 'Green')) {
            threeSameRow = true;
            colorCombiniation = 'Red & Yellow & Green';
            ulClassColorCombiniation = 'Red_Yellow_Green';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Red') && resultsKeyword.some(vendor => vendor['value'] === 'Yellow')) {
            twoSameRow = true;
            colorCombiniation = 'Red & Yellow';
            ulClassColorCombiniation = 'Red_Yellow';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Red') && resultsKeyword.some(vendor => vendor['value'] === 'Green')) {
            twoSameRow = true;
            colorCombiniation = 'Red & Green';
            ulClassColorCombiniation = 'Red_Green';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Yellow') && resultsKeyword.some(vendor => vendor['value'] === 'Red')) {
            twoSameRow = true;
            colorCombiniation = 'Yellow & Red';
            ulClassColorCombiniation = 'Yellow_Red';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Yellow') && resultsKeyword.some(vendor => vendor['value'] === 'Green')) {
            twoSameRow = true;
            colorCombiniation = 'Yellow & Green';
            ulClassColorCombiniation = 'Yellow_Green';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Green') && resultsKeyword.some(vendor => vendor['value'] === 'Red')) {
            twoSameRow = true;
            colorCombiniation = 'Green & Red';
            ulClassColorCombiniation = 'Green_Red';
        } else if (resultsKeyword.some(vendor => vendor['value'] === 'Green') && resultsKeyword.some(vendor => vendor['value'] === 'Yellow')) {
            twoSameRow = true;
            colorCombiniation = 'Green & Yellow';
            ulClassColorCombiniation = 'Green_Yellow';
        }

        console.log(" twoSameRow : "+twoSameRow+" :colorCombiniation :"+colorCombiniation+" : ulClassColorCombiniation : "+ulClassColorCombiniation , " CHANGED resultsKeyword :",resultsKeyword)

        // Create Div about elvis red,yellow and green if selected
        if (resultsKeyword.length > 0) {
            $.each(resultsKeyword, function(key, value) {

                // Game Name and Row/Pattern Prize only headings
                createDivSpecial(value.value, 's_' + value.name);

                // let str = value.name;
                // let be = str.split('_');
                // let newGameType = be[0];
                let newGameType = value.typeOfGame;
                console.log("key:-", key);
                console.log("newGameType:-", newGameType);
                console.log(' ' + value.name + '_price_div');

                let str1 = value.value;
                let be1 = str1.split(' ');
                let newForIngoreElvis = be1[0];

                // Game Name and Row/Pattern Prize only headings
                let htmlPrice = ` <div id="${value.name}_price_div" class="full-width-box tket-color-type mb-10 ${value.name}_price_div" >
                                    <div class="row" style="width:100%;">
                                        <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                            <ul>
                                                <li>
                                                    <label data-toggle="tooltip" title="${value.gameName} ${value.value}"> ${value.gameName} ${value.value} PRICE </label>
                                                </li>
                                            </ul>
                                        </div>
                                        <div class="col-lg-9 pd-l-5">
                                            <ul class="${value.name}_price_ul flx-wrp"> 

                                            </ul>
                                        </div>
                                    </div>
                                </div>`;
                //$(".s_" + value.name + "_price").append(htmlPrice);
                $(".s_" + newGameType + "_price").append(htmlPrice);

                // Game Name and Row/Pattern Prize input fields
                for (let i = 0; i < subGames[newGameType].rows.length; i++) {
                    console.log("jjjjjjjjjjjjjjjjj : ",subGames[newGameType].rows[i])
                    let read="";
                    let val = "";
                    if(subGames[newGameType].rows[i].isGameTypeExtra){
                        read="readonly";
                        val=0;
                    }

                    let options = ` <li> <div class="row">
                                                <div class="col-lg-6 pd-r-5">
                                                    <label data-toggle="tooltip" title="${value.gameName} ${subGames[newGameType].rows[i].name}"> ${subGames[newGameType].rows[i].name} </label>
                                                </div>
                                                <div class="col-lg-6 pd-l-5">
                                                    <input type="text" value="${val}" name="${value.name}${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10" ${read} required />
                                                </div></div>
                                            </li> `
                    $('.' + value.name + '_price_ul').append(options);
                }

                let sameMultipleDiv = $("." + newGameType + '_threeSameRow_price_div_extra');
                if (sameMultipleDiv.length > 0) {
                    $.each(sameMultipleDiv, function(key, value) {
                        if (key > 2) {
                            $('#' + newGameType + '_threeSameRow_price_div_extra').remove();
                        }
                    });
                }

                // Game Name and Row/Pattern Prize input Same Row for traffic light fields extra fields
                if (newForIngoreElvis != 'Elvis') {
                    // 1 color selcet
                    // check if same color div exit's or not when key == 0 so same 2 color div is remove   
                    if (key == 0) {
                        $('#' + newGameType + '_twoSameRow_price_div_extra').remove();
                    }
                    // 2 color select
                    if (twoSameRow == true) {
                        if (key > 0) {

                            // check if same color div exit's or not when key > 0 so same 3 color div is remove   
                            if ($("#" + newGameType + '_threeSameRow_price_div_extra').length != 0) {
                                let sameMultipleDiv = $("." + newGameType + '_threeSameRow_price_div_extra');
                                $.each(sameMultipleDiv, function(key, value) {
                                    $('#' + newGameType + '_threeSameRow_price_div_extra').remove();
                                });
                            }

                            let strLtd = ulClassColorCombiniation;
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            // Add Same color div with prize
                            let extraOptions = `
                                                <div id="${newGameType}_twoSameRow_price_div_extra" class="full-width-box tket-color-type mb-10 ${newGameType}_twoSameRow_price_div_extra">
                                                <input type="hidden" name="${newGameType}_twoSameRow_${ulClassColorCombiniation}" value="true">
                                                    <div class="row">
                                                        <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                                            <ul>
                                                                <li>
                                                                    <label  data-toggle="tooltip" title="${value.gameName} Same 2 Colors ${colorCombiniation}"> ${value.gameName} Same 2 Colors ${colorCombiniation} </label>
                                                                </li>
                                                            </ul>
                                                        </div>
                                                        <div class="col-lg-9 pd-l-5">
                                                        <ul class="${newGameType}_${ulClassColorCombiniation}_price_ul flx-wrp">  
                                                            </ul>
                                                        </div>
                                                    </div>
                                            </div>`;
                            $('.s_' + newGameType + '_price').append(extraOptions)

                            for (let i = 0; i < subGames[newGameType].rows.length; i++) {
                                let options = ` <li> 

                                                    <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label data-toggle="tooltip" title="${value.gameName} ${nameColor1} ${subGames[newGameType].rows[i].name}"> ${nameColor1} ${subGames[newGameType].rows[i].name} </label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="${newGameType}_${ulClassColorCombiniation}_${nameColor1}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10" required />
                                                        </div>
                                                    </div>
                                                
                                                    <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label data-toggle="tooltip" title="${value.gameName} ${nameColor2} ${subGames[newGameType].rows[i].name}"> ${nameColor2} ${subGames[newGameType].rows[i].name} </label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="${newGameType}_${ulClassColorCombiniation}_${nameColor2}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10" required />
                                                        </div>
                                                    </div>

                                                </li> `
                                $('.' + newGameType + '_' + ulClassColorCombiniation + '_price_ul').append(options);
                            }

                        }
                    }
                    // 3 color select
                    else if (threeSameRow == true) {
                        if (key > 1) {

                            // check if same color div exit's or not when key > 1 so same 2 color div is remove   
                            if ($("#" + newGameType + '_twoSameRow_price_div_extra').length != 0) {
                                $('#' + newGameType + '_twoSameRow_price_div_extra').remove();
                            }

                            let same3Color = [{
                                type: "Red_Yellow",
                                name: "Red & Yellow"
                            }, {
                                type: "Yellow_Green",
                                name: "Yellow & Green"
                            }, {
                                type: "Red_Green",
                                name: "Red & Green"
                            }];

                            for (let o = 0; o < same3Color.length; o++) {
                                // Add Same color div with prize 
                                let extraOptions = `
                                            <div id="${newGameType}_threeSameRow_price_div_extra" class="full-width-box tket-color-type mb-10 ${newGameType}_threeSameRow_price_div_extra">
                                                <input type="hidden" name="${newGameType}_threeSameRow_${same3Color[o].type}" value="true">        
                                                    <div class="row" style="width:100%;">
                                                        <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                                                            <ul>
                                                                <li>
                                                                    <label  data-toggle="tooltip" title="${value.gameName} Same Colors ${same3Color[o].name}"> ${value.gameName} Same Colors ${same3Color[o].name} </label>
                                                                </li>
                                                            </ul>
                                                        </div>
                                                        <div class="col-lg-9 pd-l-5">
                                                            <ul class="${newGameType}_${same3Color[o].type}_price_ul flx-wrp">  
                                                            </ul>
                                                        </div>
                                                    </div>
                                            </div>`;
                                $('.s_' + newGameType + '_price').append(extraOptions);
                                for (let i = 0; i < subGames[newGameType].rows.length; i++) {

                                    console.log("subGames[newGameType] subGames[newGameType] ", subGames[newGameType]);
                                    let strLtd = same3Color[o].type;
                                    let splitColor = strLtd.split('_');
                                    let nameColor1 = splitColor[0];
                                    let nameColor2 = splitColor[1];

                                    let read="";
                                    let val = "";
    
                                    if(subGames[newGameType].rows[i].isGameTypeExtra){
                                        read="readonly";
                                        val=0;
                                    }

                                    let options = ` <li> 

                                                        <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${value.gameName} ${nameColor1} ${subGames[newGameType].rows[i].name}"> ${nameColor1} ${subGames[newGameType].rows[i].name} </label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input value="${val}" ab="66666666666" ${read} type="text" name="${newGameType}_${same3Color[o].type}_${nameColor1}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10" required />
                                                            </div>
                                                        </div>
                                                    
                                                        <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${value.gameName} ${nameColor2} ${subGames[newGameType].rows[i].name}"> ${nameColor2} ${subGames[newGameType].rows[i].name} </label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input value="${val}" ab="66666666666" ${read} type="text" name="${newGameType}_${same3Color[o].type}_${nameColor2}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10" required />
                                                            </div>
                                                        </div>

                                                    </li> `
                                    $('.' + newGameType + '_' + same3Color[o].type + '_price_ul').append(options);
                                }

                            }


                        }
                    }
                }
            });
        }

        function createDivSpecial(Title, colorDivId) {
            console.log("createDivSpecial", Title, colorDivId)

            $(".color_pr").append(`<div id="${colorDivId}_color"  class="${colorDivId}_color">
            <div class="full-width-box tket-color-type mb-10 ${colorDivId}_color_div" style="display: none">
                <div class="row">
                    <div class="col-lg-3 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `"> ` + Title + ` </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-9 pd-l-5">
                        <ul class="${colorDivId}_color_ul flx-wrp">   
                        </ul>
                    </div>
                </div>
            </div>  
        </div>`);
            //$(".pattern_price").append(`<div id="${colorDivId}_price"  class="${colorDivId}_price"></div>`);
        }

        idName.sort
        existingItems.sort
            // Run difference
        let tempIdName = idName.map(item => item.name.replace(/\s/g, ''))
        console.log(" changes tempIdName : ",tempIdName , " :: existingItems :: ",existingItems)
        let diff = $(existingItems).not(tempIdName).get();
        console.log(" changes diff diff diff : ",diff)
        $.each(diff, function(key, value) {
            console.log(" value value value : "+value)
            $('#' + value.replace(/\s/g, '')).parent().remove();
            let str = value;
            let be = str.split('_');
            let newGameType = be[0];
            //$('#' + newGameType + '_threeSameRow_price_div_extra').remove();

            let sameMultipleDiv = $("." + newGameType + '_threeSameRow_price_div_extra');
            if (sameMultipleDiv.length > 2) {
                $.each(sameMultipleDiv, function(keyItem, valueItem) {
                    if (keyItem > 2) {
                        $('#' + newGameType + '_threeSameRow_price_div_extra').remove();
                    }
                });
            }

        });


        //Find value in Array
        console.log("idName", idName);
        console.log("existingItems", existingItems);
        let filteredArray = existingItems.filter(item => item.indexOf('elvis') !== -1 || item.indexOf('red') !== -1 || item.indexOf('yellow') !== -1 || item.indexOf('green') !== -1);
        console.log("filteredArray", filteredArray);

        $.each(filteredArray, function(key, value) {
            $('#s_' + value + '_color').remove();
            $('#s_' + value + '_price').remove();
            $('#' + value + '_price_div').remove();
        });
        //}
    })
});