$(document).ready(function() {

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
        let str = [];
        let cnt = 0;
        // Get elements
        let idName = $('#gameNameSelect option:selected').toArray().map(item => item.value);
        // let idName = $('#gameNameSelect option:selected').toArray().map(function(item) {
        //     let be = item.value
        //     let fields = be.split('|');
        //     return fields[1]
        // });
        console.log("Id name", idName)
            // Get the existing elements from test div
        let existingItems = $.map($('.gameColorTicketPrice > li'), li => li.id);
        // Check if elements exists - if not - add element
        $.each(idName, function(key, value) {
            if (!$("#" + value).length) {
                // Item does not exist - add
                if (value == "elvis") {
                    let html = `<li id= "${value}" class="elvis col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <select class="js-select2 s_elvis hlSl5" data-class="s_elvis" data-name="Elvis" multiple="" id="hlSl5" name= "elvisGameSelected" id ="gameTicketColorSelect">
                                        <option value="1" data-value= "5" data-class="Elvis 1">Elvis 1</option>
                                        <option value="2" data-value= "5" data-class="Elvis 2">Elvis 2</option>
                                        <option value="3" data-value= "5">Elvis 3</option>
                                        <option value="4" data-value= "5">Elvis 4</option>
                                        <option value="5" data-value= "5">Elvis 5</option>
                                    </select>
                                </div>
                                <div class="select-input">
                                    <input type="text" value="0" name= "elvisGameSelectedPrice" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Elvis', 'Elvis', 'elvigs', 's_elvis');
                } else if (value == "mystery") {
                    html = `<li id= "${value}" class="mystery col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_mystery commonCls" data-class="s_mystery" data-name="Mystery">

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystrySmallWhite" value="Small White" /><span class="span-w-90">
                                            Small White</span><input class="bx_in" name="mystrySmallWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystryLargeWhite" value="Large White" /><span class="span-w-90">
                                            Large White</span><input class="bx_in" name="mystryLargeWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystrySmallYellow" value="Small Yellow" /><span class="span-w-90">
                                            Small Yellow</span><input class="bx_in" name="mystrySmallYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystryLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                            Large Yellow</span><input class="bx_in" name="mystryLargeYellowValue" type="text"  class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystrySmallPurple" value="Small Purple" /><span class="span-w-90">
                                            Small Purple</span><input class="bx_in" name="mystrySmallPurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystryLargePurple" value="Large Purple" /><span class="span-w-90">
                                            Large Purple</span><input class="bx_in"  name="mystryLargePurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystrySmallBlue" value="Small Blue" /><span class="span-w-90">
                                            Small Blue</span><input class="bx_in" name="mystrySmallBlueValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="mystryLargeBlue" value="Large Blue" /><span class="span-w-90">
                                            Large Blue</span><input class="bx_in" name="mystryLargeBlueValue" type="text" class="w-45" value="0"/>
                                        </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Mystery', 'Mystery', 'mystery', 's_mystery');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Mystery </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 5</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row5" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> 
                <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Mystery Row 5 Winnings </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>1st Prize</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Prize1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>2nd Prize</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Prize2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>3rd Prize</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Prize3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>4th prize</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Prize4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>5th Prize</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Prize5" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                  
                            </ul>
                        </div>
                    </div>
                </div>`;
                    $(".s_mystery_price").append(htmlPrice);
                } else if (value == "1_3_5") {
                    html = `<li id= "${value}" class="1_3_5 col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_1_3_5 commonCls" data-class="s_1_3_5" data-name="1-3-5">

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveSmallWhite" value="Small White" /><span class="span-w-90">
                                            Small White</span><input class="bx_in" name="OneThreeFiveSmallWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveLargeWhite" value="Large White" /><span class="span-w-90">
                                            Large White</span><input class="bx_in" name="OneThreeFiveLargeWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                            Small Yellow</span><input class="bx_in" name="OneThreeFiveSmallYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                            Large Yellow</span><input class="bx_in" name="OneThreeFiveLargeYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveSmallPurple" value="Small Purple" /><span class="span-w-90">
                                            Small Purple</span><input class="bx_in" name="OneThreeFiveSmallPurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveLargePurple" value="Large Purple" /><span class="span-w-90">
                                            Large Purple</span><input class="bx_in" name="OneThreeFiveLargePurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveSmallBlue" value="Small Blue" /><span class="span-w-90">
                                            Small Blue</span><input class="bx_in" name="OneThreeFiveSmallBlueValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="OneThreeFiveLargeBlue" value="Large Blue" /><span class="span-w-90">
                                            Large Blue</span><input class="bx_in" name="OneThreeFiveLargeBlueValue" type="text" class="w-45" value="0"/>
                                        </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" name="OneThreeFiveValue" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('1 3 5', '1_3_5', '1_3_5', 's_1_3_5');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> 1 3 5 </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="OneThreeFiveRow1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="OneThreeFiveRow3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                   
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="OneThreeFiveBingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_1_3_5_price").append(htmlPrice);
                } else if (value == "traffic_light") {
                    html = `<li id= "${value}" class="trfc col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <select class="js-select5 s_traffic hlSl5Traffic" data-class="s_traffic" data-html="false" multiple="" name= "trafficLightGameSelected">
                                        <option value="red" data-value= "5">Red</option>
                                        <option value="yellow" data-value= "5">Yellow</option>
                                        <option value="green" data-value= "5">Green</option>
                                    </select>
                                </div>
                                <div class="select-input">
                                    <input type="text" value="0" name= "trafficLightGameSelectedPrice" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Traffic Light', 'TrafficLight', 'traffic_light', 's_traffic');
                } else if (value == "tv_extra") {
                    html = `<li id= "${value}" class="tv_extra col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_tv_extra commonCls" data-class="s_tv_extra" data-name="TV Extra">

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraSmallWhite" value="Small White" /><span class="span-w-90">
                                            Small White</span><input class="bx_in" name="tvExtraSmallWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraLargeWhite" value="Large White" /><span class="span-w-90">
                                            Large White</span><input class="bx_in" name="tvExtraLargeWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                            Small Yellow</span><input class="bx_in" name="tvExtraSmallYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                            Large Yellow</span><input class="bx_in" name="tvExtraLargeYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraSmallPurple" value="Small Purple" /><span class="span-w-90">
                                            Small Purple</span><input class="bx_in" name="tvExtraSmallPurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraLargePurple" value="Large Purple" /><span class="span-w-90">
                                            Large Purple</span><input class="bx_in" name="tvExtraLargePurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraSmallBlue" value="Small Blue" /><span class="span-w-90">
                                            Small Blue</span><input class="bx_in" name="tvExtraSmallBlueValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox" name="tvExtraLargeBlue" value="Large Blue" /><span class="span-w-90">
                                            Large Blue</span><input class="bx_in" name="tvExtraLargeBlueValue" type="text" class="w-45" value="0"/>
                                        </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('TV Extra', 'TVExtra', 'tv_extra', 's_tv_extra');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> TV Extra </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Letter T</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Lettert" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Letter X</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}LetterX" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>

                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Picture</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Picture" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                   
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Frame</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Frame" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_tv_extra_price").append(htmlPrice);
                } else if (value == "jackpot") {
                    html = `<li id= "${value}" class="jackpot col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_jackpot commonCls" data-class="s_jackpot" data-name="Jackpot">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="jackpotSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="jackpotLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="jackpotSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="jackpotLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="jackpotSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="jackpotLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="jackpotSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jackpotLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="jackpotLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Jackpot', 'Jackpot', 'jackpot', 's_jackpot');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Jackpot </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_jackpot_price").append(htmlPrice);
                } else if (value == "innstanten") {
                    html = `<li id= "${value}" class="innstanten col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_innstanten commonCls" data-class="s_innstanten" data-name="Innstanten">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="innstantenSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="innstantenLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="innstantenSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="innstantenLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="innstantenSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="innstantenLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="innstantenSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="innstantenLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="innstantenLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Innstanten', 'Innstanten', 'innstanten', 's_innstanten')
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Innstanten </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_innstanten_price").append(htmlPrice);
                } else if (value == "oddsen") {
                    html = `<li id= "${value}" class="oddsen col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_oddsen commonCls" data-class="s_oddsen" data-name="Oddsen">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="oddsenSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="oddsenLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="oddsenSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="oddsenLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="oddsenSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="oddsenLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="oddsenSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="oddsenLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="oddsenLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Oddsen', 'Oddsen', 'oddsen', 's_oddsen');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Oddsen </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_oddsen_price").append(htmlPrice);
                } else if (value == "lykkehjulet") {
                    html = `<li id= "${value}" class="lykkehjulet col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_lykkehjulet commonCls" data-class="s_lykkehjulet" data-name="Lykkehjulet">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="lykkehjuletSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="lykkehjuletLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="lykkehjuletSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="lykkehjuletLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="lykkehjuletSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="lykkehjuletLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="lykkehjuletSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="lykkehjuletLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="lykkehjuletLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Lykkehjulet', 'Lykkehjulet', 'lykkehjulet', 's_lykkehjulet');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Lykkehjulet </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_lykkehjulet_price").append(htmlPrice);
                } else if (value == "spillernes_spill") {
                    html = `<li id= "${value}" class="spillernes_spill col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_spillernes_spill commonCls" data-class="s_spillernes_spill" data-name="Spillernes Spill">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="spillernesSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="spillernesLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="spillernesSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="spillernesLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="spillernesSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="spillernesLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="spillernesSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillernesLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="spillernesLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Spillernes', 'SpillernesSpill', 'spillernes_spill', 's_spillernes_spill');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Spillernes </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_spillernes_spill_price").append(htmlPrice);
                } else if (value == "kvikkis_full_bong") {
                    html = `<li id= "${value}" class="kvikkis_full_bong col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_kvikkis_full_bong commonCls" data-class="s_kvikkis_full_bong" data-name="Kvikkis Full Bong">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="kvikkisSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="kvikkisLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="kvikkisSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="kvikkisLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="kvikkisSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="kvikkisLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="kvikkisSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="kvikkisLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="kvikkisLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Kvikkis Full', 'KvikkisFullBong', 'kvikkis_full_bong', 's_kvikkis_full_bong');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Kvikkis Full </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_kvikkis_full_bong_price").append(htmlPrice);
                } else if (value == "super_nils") {
                    html = `<li id= "${value}" class="super_nils col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_super_nils commonCls" data-class="s_super_nils" data-name="Super Nils">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="supernilsSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="supernilsLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="supernilsSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="supernilsLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="supernilsSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="supernilsLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="supernilsSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="supernilsLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="supernilsLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Super Nils', 'SuperNils', 'super_nils', 's_super_nils');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                    <div class="row">
                        <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                            <ul>
                                <li>
                                    <label> Super Nils </label>
                                </li>
                            </ul>
                        </div>
                        <div class="col-lg-10 pd-l-5">
                            <ul class="${value}_price_ul"> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 1</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                    </div></div>
                                    </li> 
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 2</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 3</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Row 4</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                    </div></div>
                                    </li>
                                    <li> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label>Bingo</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                    </div></div>
                                </li> 
                            </ul>
                        </div>
                    </div>
                </div> `;
                    $(".s_super_nils_price").append(htmlPrice);
                } else if (value == "1000_spills") {
                    html = `<li id= "${value}" class="1000_spills col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_1000_spills commonCls" data-class="s_1000_spills" data-name="1000 Spills">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10SmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="spills10SmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10LargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="spills10LargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10SmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="spills10SmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10LargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="spills10LargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10SmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="spills10SmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10LargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="spills10LargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10SmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="spills10SmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spills10LargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="spills10LargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('1000 Spills', '1000Spills', '1000_spills', 's_1000_spills');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> 1000 Spills </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row1${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row2${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row3${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row4${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Bingo${value}" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_1000_spills_price").append(htmlPrice);
                } else if (value == "fargekladden") {
                    html = `<li id= "${value}" class="fargekladden col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_fargekladden commonCls" data-class="s_fargekladden" data-name="Fargekladden">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="fargekladdenSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="fargekladdenLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="fargekladdenSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="fargekladdenLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="fargekladdenSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="fargekladdenLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="fargekladdenSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="fargekladdenLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="fargekladdenLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Fargekladden', 'Fargekladden', 'fargekladden', 's_fargekladden');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Fargekladden </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_fargekladden_price").append(htmlPrice);
                } else if (value == "skattekisten") {
                    html = `<li id= "${value}" class="skattekisten col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_skattekisten commonCls" data-class="s_skattekisten" data-name="Skattekisten">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="skattekistenSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="skattekistenLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="skattekistenSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="skattekistenLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="skattekistenSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="skattekistenLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="skattekistenSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="skattekistenLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="skattekistenLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Skattekisten', 'Skattekisten', 'skattekisten', 's_skattekisten');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Skattekisten </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_skattekisten_price").append(htmlPrice);
                } else if (value == "ball_x_10") {
                    html = `<li id= "${value}" class="ball_x_10 col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_ball_x_10 commonCls" data-class="s_ball_x_10" data-name="Ball X 10">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="ballxSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="ballxLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="ballxSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="ballxLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="ballxSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="ballxLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="ballxSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="ballxLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="ballxLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Ball X 10', 'BallX10', 'ball_x_10', 's_ball_x_10');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Ball X 10 </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_ball_x_10_price").append(htmlPrice);
                } else if (value == "500_spills") {
                    html = `<li id= "${value}" class="500_spills col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_500_spills commonCls" data-class="s_500_spills" data-name="500 Spills">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="spillsSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="spillsLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="spillsSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="spillsLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="spillsSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="spillsLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="spillsSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="spillsLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="spillsLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('500 Spills', '500Spills', '500_spills', 's_500_spills');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> 500 Spills </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row1${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row2${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row3${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row4${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Bingo${value}" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_500_spills_price").append(htmlPrice);
                } else if (value == "500_x_5") {
                    html = `<li id= "${value}" class="500_x_5 col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_500_x_5 commonCls" data-class="s_500_x_5" data-name="500 X 5">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="x5SmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="x5SmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5LargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="x5LargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5SmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="x5SmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5LargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="x5LargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5SmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="x5SmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5LargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="x5LargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5SmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="x5SmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="x5LargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="x5LargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('500 X 5', '500X5', '500_x_5', 's_500_x_5');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> 500 X 5 </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row1${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row2${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row3${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row4${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Bingo${value}" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_500_x_5_price").append(htmlPrice);
                } else if (value == "extra") {
                    html = `<li id= "${value}" class="extra col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_extra commonCls" data-class="s_extra" data-name="Extra">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="extraSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="extraSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="extraLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="extraSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="extraLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="extraSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="extraLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="extraSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="extraLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="extraLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Extra', 'Extra', 'extra', 's_extra');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Extra </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_extra_price").append(htmlPrice);
                } else if (value == "jocker") {
                    html = `<li id= "${value}" class="jocker col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_jocker commonCls" data-class="s_jocker" data-name="Jocker">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="jockerSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="jockerLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="jockerSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="jockerLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="jockerSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="jockerLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="jockerSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="jockerLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="jockerLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Jocker', 'Jocker', 'jocker', 's_jocker');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Jocker </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_jocker_price").append(htmlPrice);
                } else if (value == "2500_in_full") {
                    html = `<li id= "${value}" class="2500_in_full col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_2500_in_full commonCls" data-class="s_2500_in_full" data-name="2500 in Full">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="infullSmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="infullSmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullLargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="infullLargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="infullSmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="infullLargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullSmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="infullSmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullLargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="infullLargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullSmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="infullSmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infullLargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="infullLargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('2500 in Full', '2500InFull', '2500_in_full', 's_2500_in_full');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> 2500 in Full </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row1${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row2${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row3${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row4${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Bingo${value}" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_2500_in_full_price").append(htmlPrice);
                } else if (value == "4000_in_full") {
                    html = `<li id= "${value}" class="4000_in_full col-lg-4">
                            <div class="select-drop-input">
                                <div class="select-dropdown">
                                    <div class="dropdown_box" data-control="checkbox-dropdown">
                                        <label class="dropdown-label">Select</label>
                                        <div class="dropdown-list s_4000_in_full commonCls" data-class="s_4000_in_full" data-name="4000 in Full">

                                            <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40SmallWhite" value="Small White" /><span class="span-w-90">
                                                Small White</span><input class="bx_in" name="infull40SmallWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40LargeWhite" value="Large White" /><span class="span-w-90">
                                                Large White</span><input class="bx_in" name="infull40LargeWhiteValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40SmallYellow" value="Small Yellow" /><span class="span-w-90">
                                                Small Yellow</span><input class="bx_in" name="infull40SmallYellowValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40LargeYellow" value="Large Yellow" /><span class="span-w-90">
                                                Large Yellow</span><input class="bx_in" name="infull40LargeYellowValue" type="text"  class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40SmallPurple" value="Small Purple" /><span class="span-w-90">
                                                Small Purple</span><input class="bx_in" name="infull40SmallPurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40LargePurple" value="Large Purple" /><span class="span-w-90">
                                                Large Purple</span><input class="bx_in"  name="infull40LargePurpleValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40SmallBlue" value="Small Blue" /><span class="span-w-90">
                                                Small Blue</span><input class="bx_in" name="infull40SmallBlueValue" type="text" class="w-45" value="0"/>
                                            </label>

                                                <label class="dropdown-option">
                                                <input type="checkbox"  name="infull40LargeBlue" value="Large Blue" /><span class="span-w-90">
                                                Large Blue</span><input class="bx_in" name="infull40LargeBlueValue" type="text" class="w-45" value="0"/>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div class="select-input">
                                    <input type="text" readonly class="form-control">
                                </div>
                            </div>
                        </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('4000 in Full', '4000InFull', '4000_in_full', 's_4000_in_full');
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> 4000 in Full </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row1${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row2${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row3${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Row4${value}" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="Bingo${value}" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_4000_in_full_price").append(htmlPrice);
                } else if (value == "finale") {
                    html = `<li id= "${value}" class="finale col-lg-4">
                        <div class="select-drop-input">
                            <div class="select-dropdown">
                                <div class="dropdown_box" data-control="checkbox-dropdown">
                                    <label class="dropdown-label">Select</label>
                                    <div class="dropdown-list s_finale commonCls" data-class="s_finale" data-name="Finale">

                                        <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleSmallWhite" value="Small White" /><span class="span-w-90">
                                            Small White</span><input class="bx_in" name="finaleSmallWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleLargeWhite" value="Large White" /><span class="span-w-90">
                                            Large White</span><input class="bx_in" name="finaleLargeWhiteValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleSmallYellow" value="Small Yellow" /><span class="span-w-90">
                                            Small Yellow</span><input class="bx_in" name="finaleSmallYellowValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleLargeYellow" value="Large Yellow" /><span class="span-w-90">
                                            Large Yellow</span><input class="bx_in" name="finaleLargeYellowValue" type="text"  class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleSmallPurple" value="Small Purple" /><span class="span-w-90">
                                            Small Purple</span><input class="bx_in" name="finaleSmallPurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleLargePurple" value="Large Purple" /><span class="span-w-90">
                                            Large Purple</span><input class="bx_in"  name="finaleLargePurpleValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleSmallBlue" value="Small Blue" /><span class="span-w-90">
                                            Small Blue</span><input class="bx_in" name="finaleSmallBlueValue" type="text" class="w-45" value="0"/>
                                        </label>

                                            <label class="dropdown-option">
                                            <input type="checkbox"  name="finaleLargeBlue" value="Large Blue" /><span class="span-w-90">
                                            Large Blue</span><input class="bx_in" name="finaleLargeBlueValue" type="text" class="w-45" value="0"/>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div class="select-input">
                                <input type="text" readonly class="form-control">
                            </div>
                        </div>
                    </li>`;
                    $("ul.gameColorTicketPrice").append(html);
                    createDiv('Finale', 'Finale', 'finale', 's_finale')
                    let htmlPrice = ` <div id="${value}_price_div" class="full-width-box tket-color-type mb-10 ${value}_price_div" >
                <div class="row">
                    <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                        <ul>
                            <li>
                                <label> Finale </label>
                            </li>
                        </ul>
                    </div>
                    <div class="col-lg-10 pd-l-5">
                        <ul class="${value}_price_ul"> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 1</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row1" class="form-control" placeholder="10">
                                </div></div>
                                </li> 
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 2</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row2" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 3</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row3" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Row 4</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Row4" class="form-control" placeholder="10">
                                </div></div>
                                </li>
                                <li> <div class="row">
                                <div class="col-lg-6 pd-r-5">
                                    <label>Bingo</label>
                                </div>
                                <div class="col-lg-6 pd-l-5">
                                    <input type="text" name="${value}Bingo" class="form-control" placeholder="10">
                                </div></div>
                            </li> 
                        </ul>
                    </div>
                </div>
            </div> `;
                    $(".s_finale_price").append(htmlPrice);
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
        // Sort both arrays to prepare to compare
        idName.sort
        existingItems.sort
            // Run difference
        let diff = $(existingItems).not(idName).get();
        $.each(diff, function(key, value) {

            $('#' + value).remove();

            $('#jackpotPriceDraws' + value).remove()

            if (value == "elvis") {
                $('#jackpotPriceDrawselvigs').remove()
            }

            if (value == "traffic_light") {
                $('#s_traffic_color').remove()
            }

            $('#s_' + value + '_color').remove()

            $('#s_' + value + '_price').remove()
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

    $(document).on('change', '.hlSl5', function() {

        let total = 0;
        let text = $(this).attr('data-name');
        //let selVal = $(this).val();
        //let selVal = $(this).attr('data-value');

        var selVal = $(".hlSl5 option:selected").map(function() {
            return $(this).data("value");
        }).get();
        let selVal2 = $(this).attr('data-class');

        let fl = $(this).attr('data-html');
        // console.info('Call.....');
        // console.log('fl: ', fl);
        // console.log('fl2: ', $(this).attr('data-html'));
        // console.log('text: ', text);
        // console.log('selVal: ', selVal);
        // console.log('selVal2: ', selVal2);
        // console.log('Shiv: ', $(this).index());
        // console.info('-----------');
        //if (selVal.length > 0) {
        for (let i = 0; i < selVal.length; i++) {
            let value = selVal[i];
            total = Number(total) + Number(value);
        }
        $(this).parent().parent().children('.select-input').children().val(total);

        if (selVal2 == 's_elvis') {
            let str = [];
            let cnt = 0;
            // Get elements
            let idName = $('.hlSl5 option:selected').toArray().map(item => "elvisColorOptions" + item.value);
            let idNamePrice = $('.hlSl5 option:selected').toArray().map(item => "elvis" + item.value + "_price_div");
            console.log("elvisColorOptions value length", idName)


            if (idName.length == 0) {
                $(".s_elvis_color_div").css("display", "none")
                    //$(".s_elvis_price_div").css("display", "none")
                    //$("#elvis_color").remove();
            }
            // Get the existing elements from test div
            let existingItems = $.map($('.s_elvis_color_ul > li'), li => li.id);
            let existingItemsPrice = $.map($('.s_elvis_price > div'), div => div.id);
            // Check if elements exists - if not - add element


            $.each(idName, function(key, value) {
                if (!$("#" + value).length) {
                    // Item does not exist - add
                    if (value == "elvisColorOptions1" || value == "elvisColorOptions2" || value == "elvisColorOptions3" || value == "elvisColorOptions4" || value == "elvisColorOptions5" || value == "elvis1_price_div" || value == "elvis2_price_div" || value == "elvis3_price_div" || value == "elvis4_price_div" || value == "elvis5_price_div") {
                        $(".s_elvis_color_div").css("display", "block")
                        let html = `<li id= "${value}"> <div class="row">
                                        <div class="col-lg-6 pd-r-5">
                                            <label>Elvis ` + (value.slice(17)) + `</label>
                                        </div>
                                        <div class="col-lg-6 pd-l-5">
                                            <input type="text" name="${value}" class="form-control" placeholder="10">
                                        </div>
                                    </div></li>`;
                        $("ul.s_elvis_color_ul").append(html);

                        //$(".s_elvis_price_div").css("display", "block")
                        let htmlPrice = ` <div id="elvis${value.slice(17)}_price_div" class="full-width-box tket-color-type mb-10 elvis${value.slice(17)}_price_div" >
                                        <div class="row">
                                            <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                                <ul>
                                                    <li>
                                                        <label>Elvis ` + (value.slice(17)) + ` </label>
                                                    </li>
                                                </ul>
                                            </div>
                                            <div class="col-lg-10 pd-l-5">
                                                <ul class="elvis${value.slice(17)}_price_ul"> 
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 1</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="elvis${value.slice(17)}Row1" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li> 
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 2</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="elvis${value.slice(17)}Row2" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 3</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="elvis${value.slice(17)}Row3" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 4</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="elvis${value.slice(17)}Row4" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Bingo</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="elvis${value.slice(17)}Bingo" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li> 
                                                </ul>
                                            </div>
                                        </div>
                                    </div>`;
                        $(".s_elvis_price").append(htmlPrice);

                    }

                }
            });


            idName.sort
            existingItems.sort
                // Run difference
            let diff = $(existingItems).not(idName).get();
            $.each(diff, function(key, value) {
                $('#' + value).remove();
            });

            idNamePrice.sort
            existingItemsPrice.sort
                // Run difference

            let diffPrice = $(existingItemsPrice).not(idNamePrice).get();
            console.log("price name & diff", existingItemsPrice, idNamePrice, diffPrice)
            $.each(diffPrice, function(key, value) {
                console.log("remove color option", value)
                $('#' + value).remove();
            });

        }
        //}        

    });

    $(document).on('change', '.hlSl5Traffic', function() {
        let total = 0;
        //let text = $(this).attr('data-name');

        var selVal = $(".hlSl5Traffic option:selected").map(function() {
            return $(this).data("value");
        }).get();
        let selVal2 = $(this).attr('data-class');

        let fl = $(this).attr('data-html');

        for (let i = 0; i < selVal.length; i++) {
            let value = selVal[i];
            total = Number(total) + Number(value);
        }
        $(this).parent().parent().children('.select-input').children().val(total);

        if (selVal2 == 's_traffic') {
            let str = [];
            let cnt = 0;
            let idName = $('.hlSl5Traffic option:selected').toArray().map(item => "trafficColorOptions" + item.value);
            let idNamePrice = $('.hlSl5Traffic option:selected').toArray().map(item => "traffic" + item.value + "_price_div");

            if (idName.length == 0) {
                $(".s_traffic_color_div").css("display", "none")
            }
            let existingItems = $.map($('.s_traffic_color_ul > li'), li => li.id);
            let existingItemsPrice = $.map($('.s_traffic_price > div'), div => div.id);
            console.log("idName, idNamePrice, existingItems,existingItemsPrice ", idName, idNamePrice, existingItems, existingItemsPrice)
            $.each(idName, function(key, value) {
                if (!$("#" + value).length) {
                    if (value == "trafficColorOptionsred" || value == "trafficColorOptionsyellow" || value == "trafficColorOptionsgreen" || value == "trafficred_price_div" || value == "trafficyellow_price_div" || value == "trafficgreen_price_div") {
                        $(".s_traffic_color_div").css("display", "block")
                        let html = `<li id= "${value}"> <div class="row">
                                    <div class="col-lg-6 pd-r-5">
                                        <label> ` + (value.slice(19)) + `</label>
                                    </div>
                                    <div class="col-lg-6 pd-l-5">
                                        <input type="text" name="${value}" class="form-control" placeholder="10">
                                    </div>
                                </div></li>`;
                        $("ul.s_traffic_color_ul").append(html);

                        let htmlPrice = ` <div id="traffic${value.slice(19)}_price_div" class="full-width-box tket-color-type mb-10 traffic${value.slice(19)}_price_div" >
                                        <div class="row">
                                            <div class="col-lg-2 pd-r-5 main_tkt_lable_ttl">
                                                <ul>
                                                    <li>
                                                        <label> Traffic Light( ` + value.slice(19) + ` ) </label>
                                                    </li>
                                                </ul>
                                            </div>
                                            <div class="col-lg-10 pd-l-5">
                                                <ul class="traffic${value.slice(19)}_price_ul"> 
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 1</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="traffic${value.slice(19)}Row1" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li> 
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 2</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="traffic${value.slice(19)}Row2" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 3</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="traffic${value.slice(19)}Row3" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Row 4</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="traffic${value.slice(19)}Row4" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li>
                                                    <li> <div class="row">
                                                        <div class="col-lg-6 pd-r-5">
                                                            <label>Bingo</label>
                                                        </div>
                                                        <div class="col-lg-6 pd-l-5">
                                                            <input type="text" name="traffic${value.slice(19)}Bingo" class="form-control" placeholder="10" data-validation="required number">
                                                        </div></div>
                                                    </li> 
                                                </ul>
                                            </div>
                                        </div>
                                    </div>`;
                        $(".s_traffic_price").append(htmlPrice);
                    }

                }
            });
            idName.sort
            existingItems.sort
                // Run difference
            let diff = $(existingItems).not(idName).get();
            $.each(diff, function(key, value) {
                $('#' + value).remove();
            });

            idNamePrice.sort
            existingItemsPrice.sort
                // Run difference

            let diffPrice = $(existingItemsPrice).not(idNamePrice).get();
            console.log("price name & diff", existingItemsPrice, idNamePrice, diffPrice)
            $.each(diffPrice, function(key, value) {
                console.log("remove color option", value)
                $('#' + value).remove();
            });

        }
    });

    $(document).on("change", ".dropdown_box input[type='checkbox']", function() {
        let className = $(this).parent('.dropdown-option').parent('.dropdown-list').attr('data-class');
        console.log("checked", className);
        if (className == "s_mystery" || className == "s_1_3_5" || className == "s_tv_extra" || className == "s_jackpot" || className == "s_innstanten" || className == "s_oddsen" || className == "s_lykkehjulet" || className == "s_spillernes_spill" || className == "s_kvikkis_full_bong" || className == "s_super_nils" || className == "s_1000_spills" || className == "s_fargekladden" || className == "s_skattekisten" || className == "s_ball_x_10" || className == "s_500_spills" || className == "s_500_x_5" || className == "s_extra" || className == "s_jocker" || className == "s_2500_in_full" || className == "s_4000_in_full" || className == "s_finale") {

            let str = [];
            let cnt = 0;
            // Get elements
            //let idName = $('.' + className + ' input:checked').toArray().map(item => item.value);
            let idName = $('.' + className + ' input:checked').toArray().map(item => {
                var newObj = {};
                let resString = item.name;
                if (className == "s_1_3_5") {
                    let newRalString = resString.replace(/^.{3}/g, 'OneThreeFive');
                    newRalString = resString;
                    console.log("resString", resString);
                }
                newObj["name"] = resString;
                newObj["value"] = item.value;
                return newObj;
            });
            console.log("IdName of dynamic coilors", idName)
            let colorId = "#" + className + "_color";

            if (!$(colorId).length) {
                let colorDivname = $("." + className).attr('data-name');
                console.log("colorDivname", colorDivname)
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
                            <ul class="${className}_color_ul">   
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
            console.log("existing item", existingItems)
                // Check if elements exists - if not - add element


            $.each(idName, function(key, val) {

                //console.log("before options", val.id, $("#"+val.id.replace(/\s/g, '')).length)
                if (!$("#" + val.name.replace(/\s/g, '')).length) {
                    console.log("idName colors", val.value, val.name)
                        // Item does not exist - add
                        //if(value == "elvisColorOptions1" || value == "elvisColorOptions2"  || value == "elvisColorOptions3"  || value == "elvisColorOptions4"  || value == "elvisColorOptions5" )
                        //{
                    $('.' + className + '_color_div').css("display", "block")
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


            idName.sort
            existingItems.sort
                // Run difference
            let tempIdName = idName.map(item => item.name.replace(/\s/g, ''))
            console.log("tempIdName", tempIdName)
            let diff = $(existingItems).not(tempIdName).get();
            $.each(diff, function(key, value) {
                $('#' + value.replace(/\s/g, '')).remove();
            });
        }
    })


});