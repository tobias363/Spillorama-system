$(document).ready(function() {
    let subGames = JSON.parse(subGameColorRow.replace(/&quot;/g, '"'));
    //let subGames=[{}]
    console.log(subGames)
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
                    let html = `<li id= "${value.gameType}" class="${value.gameType} col-lg-4">
                    <p><b>[ ${value.gameName} ] :-</b></p> <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                    <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_${value.gameType} commonCls" data-class="s_${value.gameType}" data-name="${value.gameName}">
 
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
                    console.log("filteredArray", filteredArray);

                    // console.log("subGames[value.gameType].colors : ",subGames[value.gameType].colors)

                    //This function do is compare two array object and remove elivs,red,yellow,green ticket colors and store smallWhite any color 
                    let checkColorsIsIn = $(subGames[value.gameType].colors).not(filteredArray).get();
                   
                    //If color exit's so div automatic create.
                    if (checkColorsIsIn.length > 0) {
                        let htmlPrice = ` <div id="${value.gameType}_price_div" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div" >
                        <div class="row">
                            <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                <ul>
                                    <li>
                                        <label data-toggle="tooltip" title="${value.gameName}"> ${value.gameName} PRICE </label>
                                    </li>
                                </ul>
                            </div>
                            <div class="col-lg-10 pd-l-5">
                                <ul class="${value.gameType}_price_ul flx-wrp"> 
                        
                                </ul>
                            </div>
                        </div>
                    </div> 
                    <div class = "${value.gameType}_prize_div">
                        </div>`;
                        $(".s_" + value.gameType + "_price").append(htmlPrice);

                        //game Name and Row/Pattern Prize input fields

                        for (let i = 0; i < subGames[value.gameType].rows.length; i++) {
                            let options = `<li>
                                                <div class="row">
                                                    <div class="col-lg-6 pd-r-5">
                                                        <label data-toggle="tooltip" title="${subGames[value.gameType].rows[i].name}"> ${subGames[value.gameType].rows[i].name} </label>
                                                    </div>
                                                    <div class="col-lg-6 pd-l-5">
                                                        <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}" class="form-control" placeholder="10">
                                                    </div>
                                                </div>
                                            </li>`;
                            $('.' + value.gameType + '_price_ul').append(options);

                            // Game Name and Row/Pattern Prize input fields extra fields

                            // [ Mystry Game ] 
                            if (subGames[value.gameType].rows[i].isMys == true) {
                                let extraOptions = `<div id="${value.gameType}_price_div_extra" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_extra" ><div class="row">
                                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                            <ul>
                                                <li>
                                                    <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Mystery Winnings </label>
                                                </li>
                                            </ul>
                                        </div>
                                        <div class="col-lg-10 pd-l-5">
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
                                                                <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}Prize${k}" class="form-control" placeholder="10">
                                                            </div></div>
                                                        </li>  `
                                    $('.' + value.gameType + subGames[value.gameType].rows[i].type + '_price_ul').append(options);
                                }
                            }

                            // [ Treasure Chest Game ]
                            if (subGames[value.gameType].rows[i].isTchest == true) {
                                let extraOptions = `<div id="${value.gameType}_price_div_isTchest" class="full-width-box tket-color-type mb-10 ${value.gameType}_price_div_isTchest" >
                                                        <div class="row">
                                                            <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                                                <ul>
                                                                    <li>
                                                                        <label  data-toggle="tooltip" title="${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings">${value.gameName} ${subGames[value.gameType].rows[i].name} Treasure Chest Winnings </label>
                                                                    </li>
                                                                </ul>
                                                            </div>
                                                            <div class="col-lg-10 pd-l-5">
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
                                                                <input type="text" name="${value.gameType}${subGames[value.gameType].rows[i].type}isTchest${k}" class="form-control" placeholder="10">
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
            //console.log("title", Title, name, id, colorDivId)

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
                                        <input type="text" name= "jackpotPrice${name}" class="form-control" placeholder="10000">
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name= "jackpotDraws${name}" class="form-control" placeholder="51">
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
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `"> ` + Title + ` </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
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


        let idName = $('.' + className + ' input:checked').toArray().map(item => {
            console.log("item", item);
            let newObj = {};
            newObj["name"] = item.name;
            newObj["value"] = item.value;
            newObj["colorName"] = item.getAttribute('data-colorname');
            newObj["gameName"] = item.getAttribute('data-gamename');
            newObj["typeOfGame"] = item.getAttribute('data-gametype');
            return newObj;
        });

        console.log("idName", idName);

        let colorId = "#" + className + "_color";

        //Generate Number of tickets for ticket color/type tickets count header
        if (!$(colorId).length) {
            let colorDivname = $("." + className).attr('data-name');
            //console.log("colorDivname", colorDivname)
            $(".color_pr").append(`<div id="${className}_color"  class="${className}_color">
                <div class="full-width-box tket-color-type mb-10 ${className}_color_div" style="display: none">
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label data-toggle="tooltip" title="` + colorDivname + `" > ` + colorDivname + ` </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
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
        let existingItems = $.map($('.' + className + '_color_ul > li'), li => li.id);
        //console.log("existing item", existingItems)
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
                let html = `<li id= "${val.name.replace(/\s/g, '')}"> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label data-toggle="tooltip" title="` + (val.value) + `">` + (val.value) + `</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${val.name}Color" class="form-control" placeholder="10">
                                    </div>
                                </div></li>`;
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

        console.log("resultsKeyword", resultsKeyword);

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
                                    <div class="row">
                                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                            <ul>
                                                <li>
                                                    <label data-toggle="tooltip" title="${value.gameName} ${value.value}"> ${value.gameName} ${value.value} PRICE </label>
                                                </li>
                                            </ul>
                                        </div>
                                        <div class="col-lg-10 pd-l-5">
                                            <ul class="${value.name}_price_ul flx-wrp"> 

                                            </ul>
                                        </div>
                                    </div>
                                </div>`;
                //$(".s_" + value.name + "_price").append(htmlPrice);
                $(".s_" + newGameType + "_price").append(htmlPrice);

                // Game Name and Row/Pattern Prize input fields
                for (let i = 0; i < subGames[newGameType].rows.length; i++) {
                    let options = ` <li> <div class="row">
                                                <div class="col-lg-6 pd-r-5">
                                                    <label data-toggle="tooltip" title="${value.gameName} ${subGames[newGameType].rows[i].name}"> ${subGames[newGameType].rows[i].name} </label>
                                                </div>
                                                <div class="col-lg-6 pd-l-5">
                                                    <input type="text" name="${value.name}${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10">
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
                                                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                                            <ul>
                                                                <li>
                                                                    <label  data-toggle="tooltip" title="${value.gameName} Same 2 Colors ${colorCombiniation}"> ${value.gameName} Same 2 Colors ${colorCombiniation} </label>
                                                                </li>
                                                            </ul>
                                                        </div>
                                                        <div class="col-lg-10 pd-l-5">
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
                                                            <input type="text" name="${newGameType}_${ulClassColorCombiniation}_${nameColor1}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10">
                                                        </div>
                                                    </div>
                                                
                                                    <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label data-toggle="tooltip" title="${value.gameName} ${nameColor2} ${subGames[newGameType].rows[i].name}"> ${nameColor2} ${subGames[newGameType].rows[i].name} </label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="${newGameType}_${ulClassColorCombiniation}_${nameColor2}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10">
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
                                                    <div class="row">
                                                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                                            <ul>
                                                                <li>
                                                                    <label  data-toggle="tooltip" title="${value.gameName} Same Colors ${same3Color[o].name}"> ${value.gameName} Same Colors ${same3Color[o].name} </label>
                                                                </li>
                                                            </ul>
                                                        </div>
                                                        <div class="col-lg-10 pd-l-5">
                                                            <ul class="${newGameType}_${same3Color[o].type}_price_ul flx-wrp">  
                                                            </ul>
                                                        </div>
                                                    </div>
                                            </div>`;
                                $('.s_' + newGameType + '_price').append(extraOptions);
                                for (let i = 0; i < subGames[newGameType].rows.length; i++) {

                                    console.log("same3Color[o]", same3Color[o].type);
                                    let strLtd = same3Color[o].type;
                                    let splitColor = strLtd.split('_');
                                    let nameColor1 = splitColor[0];
                                    let nameColor2 = splitColor[1];

                                    let options = ` <li> 

                                                        <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${value.gameName} ${nameColor1} ${subGames[newGameType].rows[i].name}"> ${nameColor1} ${subGames[newGameType].rows[i].name} </label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input type="text" name="${newGameType}_${same3Color[o].type}_${nameColor1}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10">
                                                            </div>
                                                        </div>
                                                    
                                                        <div class="row">
                                                            <div class="col-lg-6 pd-r-5">
                                                                <label data-toggle="tooltip" title="${value.gameName} ${nameColor2} ${subGames[newGameType].rows[i].name}"> ${nameColor2} ${subGames[newGameType].rows[i].name} </label>
                                                            </div>
                                                            <div class="col-lg-6 pd-l-5">
                                                                <input type="text" name="${newGameType}_${same3Color[o].type}_${nameColor2}_${subGames[newGameType].rows[i].type}" class="form-control" placeholder="10">
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
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label data-toggle="tooltip" title="` + Title + `"> ` + Title + ` </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
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
        let diff = $(existingItems).not(tempIdName).get();
        $.each(diff, function(key, value) {
            $('#' + value.replace(/\s/g, '')).remove();
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

    // let keyword = 'elvis';
    // let resultsKeyword = idName.filter(object => Object.values(object).some(i => i.includes(keyword)));
    // console.log("resultsKeyword", resultsKeyword);

    // if (resultsKeyword.length > 0) {
    //     $.each(resultsKeyword, function(key, value) {
    //         console.log("key, value", key, value);

    //         if (value.value == "Elvis 1" || value.value == "Elvis 2" || value.value == "Elvis 3" || value.value == "Elvis 4" || value.value == "Elvis 5") {
    //             $(".s_elvis_color_div").css("display", "block")
    //             let html = `<li id= "${value}"> <div class="row">
    //                             <div class="col-lg-6 pd-r-5">
    //                                 <label>Elvis ` + value.value + `</label>
    //                             </div>
    //                             <div class="col-lg-6 pd-l-5">
    //                                 <input type="text" name="${value}" class="form-control" placeholder="10">
    //                             </div>
    //                         </div></li>`;
    //             $(".s_" + value.gameType + "_price").append(html);

    //             //$(".s_elvis_price_div").css("display", "block")
    //             let htmlPrice = ` <div id="elvis${value.value}_price_div" class="full-width-box tket-color-type mb-10 elvis${value.value}_price_div" >
    //                             <div class="row">
    //                                 <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
    //                                     <ul>
    //                                         <li>
    //                                             <label>Elvis ` + value.value + ` </label>
    //                                         </li>
    //                                     </ul>
    //                                 </div>
    //                                 <div class="col-lg-10 pd-l-5">
    //                                     <ul class="elvis${value.value}_price_ul"> 
    //                                         <li> <div class="row">
    //                                             <div class="col-lg-6 pd-r-5">
    //                                                 <label>Row 1</label>
    //                                             </div>
    //                                             <div class="col-lg-6 pd-l-5">
    //                                                 <input type="text" name="elvis${value.value}Row1" class="form-control" placeholder="10" data-validation="required number">
    //                                             </div></div>
    //                                         </li> 
    //                                         <li> <div class="row">
    //                                             <div class="col-lg-6 pd-r-5">
    //                                                 <label>Row 2</label>
    //                                             </div>
    //                                             <div class="col-lg-6 pd-l-5">
    //                                                 <input type="text" name="elvis${value.value}Row2" class="form-control" placeholder="10" data-validation="required number">
    //                                             </div></div>
    //                                         </li>
    //                                         <li> <div class="row">
    //                                             <div class="col-lg-6 pd-r-5">
    //                                                 <label>Row 3</label>
    //                                             </div>
    //                                             <div class="col-lg-6 pd-l-5">
    //                                                 <input type="text" name="elvis${value.value}Row3" class="form-control" placeholder="10" data-validation="required number">
    //                                             </div></div>
    //                                         </li>
    //                                         <li> <div class="row">
    //                                             <div class="col-lg-6 pd-r-5">
    //                                                 <label>Row 4</label>
    //                                             </div>
    //                                             <div class="col-lg-6 pd-l-5">
    //                                                 <input type="text" name="elvis${value.value}Row4" class="form-control" placeholder="10" data-validation="required number">
    //                                             </div></div>
    //                                         </li>
    //                                         <li> <div class="row">
    //                                             <div class="col-lg-6 pd-r-5">
    //                                                 <label>Bingo</label>
    //                                             </div>
    //                                             <div class="col-lg-6 pd-l-5">
    //                                                 <input type="text" name="elvis${value.value}Bingo" class="form-control" placeholder="10" data-validation="required number">
    //                                             </div></div>
    //                                         </li> 
    //                                     </ul>
    //                                 </div>
    //                             </div>
    //                         </div>`;
    //             $('.' + value.gameType + '_price_ul').append(htmlPrice);

    //         }

    //     });
    // }


    // $(document).on('change', ".elvis_color_type input[type='checkbox']", function() {
    //     console.log("elvis color type called")
    //     let total = 0;
    //     let text = $(this).attr('data-name');
    //     //let selVal = $(this).val();
    //     //let selVal = $(this).attr('data-value');

    //     var selVal = $(".elvis_color_type option:selected").map(function() {
    //         return $(this).data("value");
    //     }).get();
    //     let selVal2 = $(this).attr('data-class');

    //     let fl = $(this).attr('data-html');
    //     console.info('Call.....');
    //     console.log('fl: ', fl);
    //     console.log('fl2: ', $(this).attr('data-html'));
    //     console.log('text: ', text);
    //     console.log('selVal: ', selVal);
    //     console.log('selVal2: ', selVal2);
    //     console.log('Shiv: ', $(this).index());
    //     console.info('-----------');
    //     //if (selVal.length > 0) {
    //     for (let i = 0; i < selVal.length; i++) {
    //         let value = selVal[i];
    //         total = Number(total) + Number(value);
    //     }
    //     $(this).parent().parent().children('.select-input').children().val(total);

    //     if (selVal2 == 's_elvis') {
    //         let str = [];
    //         let cnt = 0;
    //         // Get elements
    //         let idName = $('.hlSl5 option:selected').toArray().map(item => "elvisColorOptions" + item.value);
    //         let idNamePrice = $('.hlSl5 option:selected').toArray().map(item => "elvis" + item.value + "_price_div");
    //         console.log("elvisColorOptions value length", idName)


    //         if (idName.length == 0) {
    //             $(".s_elvis_color_div").css("display", "none")
    //                 //$(".s_elvis_price_div").css("display", "none")
    //                 //$("#elvis_color").remove();
    //         }
    //         // Get the existing elements from test div
    //         let existingItems = $.map($('.s_elvis_color_ul > li'), li => li.id);
    //         let existingItemsPrice = $.map($('.s_elvis_price > div'), div => div.id);
    //         // Check if elements exists - if not - add element


    //         $.each(idName, function(key, value) {
    //             if (!$("#" + value).length) {
    //                 // Item does not exist - add
    //                 if (value == "elvisColorOptions1" || value == "elvisColorOptions2" || value == "elvisColorOptions3" || value == "elvisColorOptions4" || value == "elvisColorOptions5" || value == "elvis1_price_div" || value == "elvis2_price_div" || value == "elvis3_price_div" || value == "elvis4_price_div" || value == "elvis5_price_div") {
    //                     $(".s_elvis_color_div").css("display", "block")
    //                     let html = `<li id= "${value}"> <div class="row">
    //                                     <div class="col-lg-6 pd-r-5">
    //                                         <label>Elvis ` + (value.slice(17)) + `</label>
    //                                     </div>
    //                                     <div class="col-lg-6 pd-l-5">
    //                                         <input type="text" name="${value}" class="form-control" placeholder="10">
    //                                     </div>
    //                                 </div></li>`;
    //                     $("ul.s_elvis_color_ul").append(html);

    //                     //$(".s_elvis_price_div").css("display", "block")
    //                     let htmlPrice = ` <div id="elvis${value.slice(17)}_price_div" class="full-width-box tket-color-type mb-10 elvis${value.slice(17)}_price_div" >
    //                                     <div class="row">
    //                                         <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
    //                                             <ul>
    //                                                 <li>
    //                                                     <label>Elvis ` + (value.slice(17)) + ` </label>
    //                                                 </li>
    //                                             </ul>
    //                                         </div>
    //                                         <div class="col-lg-10 pd-l-5">
    //                                             <ul class="elvis${value.slice(17)}_price_ul"> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 1</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row1" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 2</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row2" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 3</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row3" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 4</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row4" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Bingo</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Bingo" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                             </ul>
    //                                         </div>
    //                                     </div>
    //                                 </div>`;
    //                     $(".s_elvis_price").append(htmlPrice);

    //                 }

    //             }
    //         });


    //         idName.sort
    //         existingItems.sort
    //             // Run difference
    //         let diff = $(existingItems).not(idName).get();
    //         $.each(diff, function(key, value) {
    //             $('#' + value).remove();
    //         });

    //         idNamePrice.sort
    //         existingItemsPrice.sort
    //             // Run difference

    //         let diffPrice = $(existingItemsPrice).not(idNamePrice).get();
    //         console.log("price name & diff", existingItemsPrice, idNamePrice, diffPrice)
    //         $.each(diffPrice, function(key, value) {
    //             console.log("remove color option", value)
    //             $('#' + value).remove();
    //         });

    //     }
    //     //}        

    // });


    // $(document).on('change', '.hlSl5', function() {

    //     let total = 0;
    //     let text = $(this).attr('data-name');
    //     //let selVal = $(this).val();
    //     //let selVal = $(this).attr('data-value');

    //     var selVal = $(".hlSl5 option:selected").map(function() {
    //         return $(this).data("value");
    //     }).get();
    //     let selVal2 = $(this).attr('data-class');

    //     let fl = $(this).attr('data-html');
    //     // console.info('Call.....');
    //     // console.log('fl: ', fl);
    //     // console.log('fl2: ', $(this).attr('data-html'));
    //     // console.log('text: ', text);
    //     // console.log('selVal: ', selVal);
    //     // console.log('selVal2: ', selVal2);
    //     // console.log('Shiv: ', $(this).index());
    //     // console.info('-----------');
    //     //if (selVal.length > 0) {
    //     for (let i = 0; i < selVal.length; i++) {
    //         let value = selVal[i];
    //         total = Number(total) + Number(value);
    //     }
    //     $(this).parent().parent().children('.select-input').children().val(total);

    //     if (selVal2 == 's_elvis') {
    //         let str = [];
    //         let cnt = 0;
    //         // Get elements
    //         let idName = $('.hlSl5 option:selected').toArray().map(item => "elvisColorOptions" + item.value);
    //         let idNamePrice = $('.hlSl5 option:selected').toArray().map(item => "elvis" + item.value + "_price_div");
    //         console.log("elvisColorOptions value length", idName)


    //         if (idName.length == 0) {
    //             $(".s_elvis_color_div").css("display", "none")
    //                 //$(".s_elvis_price_div").css("display", "none")
    //                 //$("#elvis_color").remove();
    //         }
    //         // Get the existing elements from test div
    //         let existingItems = $.map($('.s_elvis_color_ul > li'), li => li.id);
    //         let existingItemsPrice = $.map($('.s_elvis_price > div'), div => div.id);
    //         // Check if elements exists - if not - add element


    //         $.each(idName, function(key, value) {
    //             if (!$("#" + value).length) {
    //                 // Item does not exist - add
    //                 if (value == "elvisColorOptions1" || value == "elvisColorOptions2" || value == "elvisColorOptions3" || value == "elvisColorOptions4" || value == "elvisColorOptions5" || value == "elvis1_price_div" || value == "elvis2_price_div" || value == "elvis3_price_div" || value == "elvis4_price_div" || value == "elvis5_price_div") {
    //                     $(".s_elvis_color_div").css("display", "block")
    //                     let html = `<li id= "${value}"> <div class="row">
    //                                     <div class="col-lg-6 pd-r-5">
    //                                         <label>Elvis ` + (value.slice(17)) + `</label>
    //                                     </div>
    //                                     <div class="col-lg-6 pd-l-5">
    //                                         <input type="text" name="${value}" class="form-control" placeholder="10">
    //                                     </div>
    //                                 </div></li>`;
    //                     $("ul.s_elvis_color_ul").append(html);

    //                     //$(".s_elvis_price_div").css("display", "block")
    //                     let htmlPrice = ` <div id="elvis${value.slice(17)}_price_div" class="full-width-box tket-color-type mb-10 elvis${value.slice(17)}_price_div" >
    //                                     <div class="row">
    //                                         <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
    //                                             <ul>
    //                                                 <li>
    //                                                     <label>Elvis ` + (value.slice(17)) + ` </label>
    //                                                 </li>
    //                                             </ul>
    //                                         </div>
    //                                         <div class="col-lg-10 pd-l-5">
    //                                             <ul class="elvis${value.slice(17)}_price_ul"> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 1</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row1" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 2</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row2" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 3</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row3" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 4</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Row4" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Bingo</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="elvis${value.slice(17)}Bingo" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                             </ul>
    //                                         </div>
    //                                     </div>
    //                                 </div>`;
    //                     $(".s_elvis_price").append(htmlPrice);

    //                 }

    //             }
    //         });


    //         idName.sort
    //         existingItems.sort
    //             // Run difference
    //         let diff = $(existingItems).not(idName).get();
    //         $.each(diff, function(key, value) {
    //             $('#' + value).remove();
    //         });

    //         idNamePrice.sort
    //         existingItemsPrice.sort
    //             // Run difference

    //         let diffPrice = $(existingItemsPrice).not(idNamePrice).get();
    //         console.log("price name & diff", existingItemsPrice, idNamePrice, diffPrice)
    //         $.each(diffPrice, function(key, value) {
    //             console.log("remove color option", value)
    //             $('#' + value).remove();
    //         });

    //     }
    //     //}        

    // });

    // $(document).on('change', '.hlSl5Traffic', function() {
    //     let total = 0;
    //     //let text = $(this).attr('data-name');

    //     var selVal = $(".hlSl5Traffic option:selected").map(function() {
    //         return $(this).data("value");
    //     }).get();
    //     let selVal2 = $(this).attr('data-class');

    //     let fl = $(this).attr('data-html');

    //     for (let i = 0; i < selVal.length; i++) {
    //         let value = selVal[i];
    //         total = Number(total) + Number(value);
    //     }
    //     $(this).parent().parent().children('.select-input').children().val(total);

    //     if (selVal2 == 's_traffic') {
    //         let str = [];
    //         let cnt = 0;
    //         let idName = $('.hlSl5Traffic option:selected').toArray().map(item => "trafficColorOptions" + item.value);
    //         let idNamePrice = $('.hlSl5Traffic option:selected').toArray().map(item => "traffic" + item.value + "_price_div");

    //         if (idName.length == 0) {
    //             $(".s_traffic_color_div").css("display", "none")
    //         }
    //         let existingItems = $.map($('.s_traffic_color_ul > li'), li => li.id);
    //         let existingItemsPrice = $.map($('.s_traffic_price > div'), div => div.id);
    //         console.log("idName, idNamePrice, existingItems,existingItemsPrice ", idName, idNamePrice, existingItems, existingItemsPrice)
    //         $.each(idName, function(key, value) {
    //             if (!$("#" + value).length) {
    //                 if (value == "trafficColorOptionsred" || value == "trafficColorOptionsyellow" || value == "trafficColorOptionsgreen" || value == "trafficred_price_div" || value == "trafficyellow_price_div" || value == "trafficgreen_price_div") {
    //                     $(".s_traffic_color_div").css("display", "block")
    //                     let html = `<li id= "${value}"> <div class="row">
    //                                 <div class="col-lg-6 pd-r-5">
    //                                     <label> ` + (value.slice(19)) + `</label>
    //                                 </div>
    //                                 <div class="col-lg-6 pd-l-5">
    //                                     <input type="text" name="${value}" class="form-control" placeholder="10">
    //                                 </div>
    //                             </div></li>`;
    //                     $("ul.s_traffic_color_ul").append(html);

    //                     let htmlPrice = ` <div id="traffic${value.slice(19)}_price_div" class="full-width-box tket-color-type mb-10 traffic${value.slice(19)}_price_div" >
    //                                     <div class="row">
    //                                         <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
    //                                             <ul>
    //                                                 <li>
    //                                                     <label> Traffic Light( ` + value.slice(19) + ` ) </label>
    //                                                 </li>
    //                                             </ul>
    //                                         </div>
    //                                         <div class="col-lg-10 pd-l-5">
    //                                             <ul class="traffic${value.slice(19)}_price_ul"> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 1</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="traffic${value.slice(19)}Row1" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 2</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="traffic${value.slice(19)}Row2" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 3</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="traffic${value.slice(19)}Row3" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Row 4</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="traffic${value.slice(19)}Row4" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li>
    //                                                 <li> <div class="row">
    //                                                     <div class="col-lg-6 pd-r-5">
    //                                                         <label>Bingo</label>
    //                                                     </div>
    //                                                     <div class="col-lg-6 pd-l-5">
    //                                                         <input type="text" name="traffic${value.slice(19)}Bingo" class="form-control" placeholder="10" data-validation="required number">
    //                                                     </div></div>
    //                                                 </li> 
    //                                             </ul>
    //                                         </div>
    //                                     </div>
    //                                 </div>`;
    //                     $(".s_traffic_price").append(htmlPrice);
    //                 }

    //             }
    //         });
    //         idName.sort
    //         existingItems.sort
    //             // Run difference
    //         let diff = $(existingItems).not(idName).get();
    //         $.each(diff, function(key, value) {
    //             $('#' + value).remove();
    //         });

    //         idNamePrice.sort
    //         existingItemsPrice.sort
    //             // Run difference

    //         let diffPrice = $(existingItemsPrice).not(idNamePrice).get();
    //         console.log("price name & diff", existingItemsPrice, idNamePrice, diffPrice)
    //         $.each(diffPrice, function(key, value) {
    //             console.log("remove color option", value)
    //             $('#' + value).remove();
    //         });

    //     }
    // });




});