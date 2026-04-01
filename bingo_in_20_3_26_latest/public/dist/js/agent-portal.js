$(document).ready(function () {
    const translate = JSON.parse(window.i18nMessages) || {};
    console.log("translate", translate)
    $('.section-toggle').click(function (e) {
        e.preventDefault();
        let target = $(this).data('target');
        // Hide all sections first
        $('.content-section').addClass('hidden');
        console.log("target--", target)
        if (target === 'default') {
            $('#defaultModule').removeClass('hidden');
            $('#agentModule').removeClass('hidden');
            $('#gameModule').removeClass('hidden');
        } else if (target === 'agent') {
            $('#defaultModule').removeClass('hidden');
            $('#agentModule').removeClass('hidden');
        } else if (target === 'game') {
            $('#gameModule').removeClass('hidden');
        }
        // Set active class on the clicked tab
        $('.nav-tabs li').removeClass('active');
        $(this).parent().addClass('active');
    });

    let host = window.location.origin;
    const hallId = $("#hallId").val();
    // Register More ticket with Edit

    $("#registerMoreTicketsLink").click(function (e) {
        e.preventDefault();
        if (hallId) {
            let table = $("#registerMoreTicketTable").DataTable();
            table.ajax.url(host + "/getPhysicalTickets").load();
        }
        $('#registerMoreTicketModal').modal('show');
    });

    $("#addMoneyUniqueId").click(function (e) {
        e.preventDefault();
        openUniqueIdModal('Add Money - Unique Id', 'add', 'Add', true);
    });

    $("#withdrawUniqueId").click(function (e) {
        e.preventDefault();
        openUniqueIdModal('Withdraw Money - Unique Id', 'withdraw', 'Withdraw', false);
    });

    $("#addMoneyUser").click(function (e) {
        e.preventDefault();
        openRegisterUserdModal('Add Money - Register User', 'add', 'Add');
    });

    $("#withdrawUser").click(function (e) {
        e.preventDefault();
        openRegisterUserdModal('Withdraw Money - Register User', 'withdraw', 'Withdraw');
    });

    $(".upcomingGameList").click(function (e) {console.log("upcomingGameList called")
        e.preventDefault();
        let parentGameId = $(this).attr("data-parentgameid"); //let parentGameId = $("#upcomingGameList").attr("data-parentgameid");
        openUpcomingGameModal(parentGameId)
        // $('#upcomingGamesTable').DataTable().ajax.url(host + "/agent/upcoming-game/get?parentGameId=" + parentGameId).load();
        //$('#upcomingGamesModal').modal('show');
    });

    let isModalOpen = false;
    let isScannerProcessing = false;

    $(".scanButton").on("click", function () {
        let initialId = $(".initialId").val();
        if (!initialId) {
            $(".initialId").focus();
        }
    });

    $(".scanButtonSoldTicket").on("click", function () {
        let finalId = $(".finalIdSoldTicket").val();
        if (!finalId) {
            $(".finalIdSoldTicket").focus()
        }
    });

    // New Scanner flow to scan register and sold tickets
    ["initialId", "finalIdSoldTicket", "editInitialId"].forEach(id => {
        attachScannerListener(id);
    });
    
    function attachScannerListener(id) {
        let input = document.getElementById(id);
        if (!input) return; // Ensure the element exists before attaching the event
        
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !isScannerProcessing) {
                e.preventDefault();
                e.stopPropagation();
                isScannerProcessing = true;
                process_scanner_input(input);
            }else if (e.key === "Space" && !isScannerProcessing) {
                e.preventDefault();
                e.stopPropagation();
                process_manual_tickets_entry();
            }
        });
    }

    function process_scanner_input(input) {
        let scanned_value = input.value.trim();
        if (scanned_value.length >= 22) {
            scanned_value = scanned_value.slice(-22);
            let extractedNumber = scanned_value.substr(14, 7);

            // Ensure only numeric values are assigned
            if (!isNaN(extractedNumber)) {
                input.value = "";  // Clear input field before assigning value
                setTimeout(() => {
                    input.value = +extractedNumber;
                    console.log("Extracted input.value:", +input.value);
                }, 50);  // Slight delay to ensure proper assignment
            }
        }
        // Wait 500ms before allowing new input to prevent fast resubmissions
        setTimeout(() => {
            isScannerProcessing = false;
        }, 500);
        
    }

    function process_manual_tickets_entry() {
        if (isScannerProcessing) return; // Prevent submission during scanner processing
        if ($('#registerMoreTicketModal').hasClass('in') && !$('#editModal').hasClass('in')) {
            $('.submitButton').click();
        } else if ($('#registerSoldTicketModal').hasClass('in')) {
            $('.purchasePhysicalTickets').click();
        } else if($('#editModal').hasClass('in')){
            $('.submitEditButton').click();
        }
    }

    document.addEventListener("keydown", function (e) {
        if (e.target.tagName !== "INPUT") {
            // Ensure only executes if the correct modal is open
            if ($('#registerMoreTicketModal').hasClass('in') && !$('#editModal').hasClass('in')) {
                console.log("Focusing initialId...");
                $('#initialId').focus();  
            }else if($('#registerSoldTicketModal').hasClass('in')){
                console.log("Focusing finalIdSoldTicket...");
                $('#finalIdSoldTicket').focus();
            }else if($('#editModal').hasClass('in')){
                console.log("Focusing Edit initialId...");
                $('#editInitialId').focus();
            }
        }
    });

    // New Scanner flow

    //$("#addPhysicalTicketForm").submit(function( event ){
    $('.submitButton').click(function (event) {
        event.preventDefault();
        $(".submitButton").attr("disabled", true);
        $(".scanButton").attr("disabled", true);
        if (!$("#addPhysicalTicketForm").isValid()) {
            if ($(".has-error").length) {
                let el = $('.has-error').first();
                if (!$.isEmptyObject(el)) {
                    $('html, body').animate({
                        scrollTop: (el.offset().top)
                    }, 10);
                }
            }
            $(".submitButton").attr("disabled", false);
            $(".scanButton").attr("disabled", false);
        }

        let initialId = $(".initialId").val();

        if (initialId) {
            $.ajax({
                type: 'GET',
                url: host + "/getLastRegisteredId",
                data: { 'initialId': initialId, hallId: $('#hallName').find(":selected").val() },
                success: function (resultData) {
                    console.log("resultData registered", resultData)
                    if (resultData.status == "success") {
                        let isSubmit = true;
                        if (resultData.lastId != "") {
                            if (+resultData.lastId + 1 != initialId) {
                                isSubmit = false;
                            }
                        }
                        if (isSubmit == false) {
                            let previousWindowKeyDown = window.onkeydown;
                            swal({
                                title: `${translate.are_you_sure}?`,
                                text: `${translate.registering_non_seq_id}.`,
                                icon: "warning",
                                showCancelButton: true,
                                confirmButtonColor: "#e69a2a",
                                confirmButtonText: `${translate.yes}.`,
                                cancelButtonText: `${translate.cancel_button}.`,
                                closeOnConfirm: true,
                                closeOnCancel: true
                            }, function (isConfirm) {
                                window.onkeydown = previousWindowKeyDown;
                                if (isConfirm) {
                                    addPhysicalTickets();
                                } else {
                                    $(".submitButton").attr("disabled", false);
                                    $(".scanButton").attr("disabled", false);
                                    let selectedValue = $('#hallName').find(":selected").val();
                                    $('#addPhysicalTicketForm')[0].reset();
                                    if (selectedValue) {
                                        $('#hallName').val(selectedValue);
                                    }
                                    $(".initialId").focus();
                                }
                                window.onkeydown = previousWindowKeyDown;
                            });

                        } else {
                            addPhysicalTickets();
                        }
                    } else {
                        $(".alert-error-text").html(resultData.message);
                        $(".alertError").show().delay(2000).fadeOut();
                        $(".submitButton").attr("disabled", false);
                        $(".scanButton").attr("disabled", false);
                    }
                },
                error: function (d, s, e) {
                    console.log("error occured", s, e);
                }
            });

            function addPhysicalTickets() {
                $.ajax({
                    type: "POST",
                    url: `/addPhysicalTickets`,
                    data: {
                        initialId: initialId,
                        hallId: $('#hallName').find(":selected").val()
                    },
                    success: function (response) {
                        console.log("response", response)
                        if (response.status == "success") {
                            $(".alert-success-text").html(response.message);
                            $(".alertSuccess").show().delay(2000).fadeOut();

                        } else {
                            $(".alert-error-text").html(response.message);
                            $(".alertError").show().delay(2000).fadeOut();
                        }
                        let table = $("#registerMoreTicketTable").DataTable();
                        let selectedValue = $('#hallName').find(":selected").val();
                        if (selectedValue) {
                            table.ajax.url(host + "/getPhysicalTickets?hallId=" + selectedValue).load();
                        } else {
                            table.ajax.url(host + "/getPhysicalTickets").load();
                        }
                    },
                    complete: function (data) {
                        $(".submitButton").attr("disabled", false);
                        $(".scanButton").attr("disabled", false);
                        //$('#addPhysicalTicketForm')[0].reset();
                        //$('form:first *:input[type!=hidden]:first').focus();
                        let selectedValue = $('#hallName').find(":selected").val();
                        $('#addPhysicalTicketForm')[0].reset();
                        if (selectedValue) {
                            $('#hallName').val(selectedValue);
                        }
                        $(".initialId").focus();
                        // $(".initialId").val("");
                        // $(".finalId").val("");
                        // $(".initialId").focus();

                    },
                    error: function (d, s, e) {
                        console.log("error occured", d, s, e);
                    }
                });
            }

        }
    });


    $('#registerMoreTicketTable').DataTable({
        "oLanguage": {
            "sSearch": `${translate.search}`,
            "sLengthMenu": `${translate.show} _MENU_ ${translate.entries}`,
            "oPaginate": {
                sPrevious: `${translate.previous}`,
                sNext: `${translate.next}`
            },
            "sEmptyTable": `${translate.no_data_available_in_table}`
        },
        "bSort": false,
        "order": [[0, "desc"]],
        "columnDefs": [{
            "targets": [],
            "orderable": false,
        },
        { className: 'text-center', targets: [4] },
        ],
        "scrollX": false,
        "searching": true,
        "processing": true,
        //"serverSide": true,
        "autoWidth": false,
        //"pageLength": 10,
        "bLengthChange": false,
        "ajax": {
            url: host + "/getPhysicalTickets",
            type: "GET",
        },
        "columns": [
            { "data": "ticketColor" },
            { "data": "initialId" },
            { "data": "finalId" },
            { "data": "soldTicketCount" },
            {
                "data": "action",
                render: function (data, type, row) {
                    let html = '<div style="width : 100px !important;margin : 0 auto;text-align: center;">';
                    html += ` <button type="button" name="edit"  id="` + row.id + `"class="btn btn-warning btn-xs btn-edit edit" title="Edit Registered Tickets" data-toggle="modal" data-target="#editModal"><i class="fa fa-edit" aria-hidden="true"></i></button> `
                    html += ` <button type="button" name="delete"  id="` + row.id + `"class="btn btn-danger btn-xs btn-delete delete" title="Delete Registered Tickets"><i class="fa fa-trash" aria-hidden="true"></i></button>`;

                    html += '</div>'
                    return html;

                }
            }
        ],
    });

    $('body').on('click', '.delete', function (e) {
        let id = $(this).attr('id');
        let thisElement = this;
        let previousWindowKeyDown = window.onkeydown;
        swal({
            title: `${translate.sure_want_to_delete_physical_ticket}?`,
            text: `${translate.not_be_able_to_recover_physical_ticket}!`,
            type: "warning",
            showCancelButton: true,
            confirmButtonColor: "#e69a2a",
            confirmButtonText: `${translate.delete_button}`,
            cancelButtonText: `${translate.cancel_button}`,
            closeOnConfirm: false,
            closeOnCancel: false
        }, function (isConfirm) {
            window.onkeydown = previousWindowKeyDown;
            if (isConfirm) {
                $.ajax({
                    type: 'POST',
                    url: host + "/deletePhysicalTicket",
                    data: {
                        id: id,
                        hallId: $('#hallName').find(":selected").val()
                    },
                    success: function (resultData) {
                        if (resultData == 'success') {
                            //let table = $("#registerMoreTicketTable").DataTable();
                            //table.ajax.url(host + "/getPhysicalTickets").load();
                            swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}.`, "success");
                        } else {
                            alert("Something went wrong")
                        }
                        let table = $("#registerMoreTicketTable").DataTable();
                        let selectedValue = $('#hallName').find(":selected").val();
                        if (selectedValue) {
                            table.ajax.url(host + "/getPhysicalTickets?hallId=" + selectedValue).load();
                        } else {
                            table.ajax.url(host + "/getPhysicalTickets").load();
                        }

                    }
                });
                swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}`, "success");
            } else {
                swal(`${translate.cancelled}`, `${translate.physical_ticket_not_deleted}`, "error");
            }
            window.onkeydown = previousWindowKeyDown;
        });
        return false;
    });

    // Edit functionality

    $(".scanEditButton").on("click", function () {
        let initialId = $(".editInitialId").val();
        //let finalId = $(".editFinalId").val();
        if (!initialId) {
            $(".editInitialId").focus();
        } else {
            // if(!finalId){
            //    $(".editFinalId").focus()
            // }
        }
    });

    $('#editModal').on('shown.bs.modal', function (event) {
        let id = $(event.relatedTarget).attr('id');
        console.log("id---", id)

        $.ajax({
            type: 'GET',
            url: host + "/getEditRegisteredId",
            data: {
                id: id,
                hallId: $('#hallName').find(":selected").val()
            },
            success: function (resultData) {
                console.log("resultData of edit view", resultData)
                if (resultData.status == "success") {
                    console.log("inside")
                    $(".editInitialId").val(resultData.editInitialId);
                    $(".editFinalId").val(resultData.editLastId);
                    $(".editTicketColorId").val(id)
                }
            },
            error: function (d, s, e) {
                console.log("error occured", s, e);
                $('#registerMoreTicketErrorContainer').html(`${translate.erro_fetching_balance}`);
                $('#registerMoreTicketErrorContainer').removeClass('hidden');
                setTimeout(function () {
                    $('#editRegisterTicketForm')[0].reset();
                    $('#registerMoreTicketErrorContainer').addClass('hidden');
                }, 3000);
            }
        });
    });

    $('#editModal').on('hidden.bs.modal', function () {
        $('#openModalSpinner').removeClass('hidden');
        $('.agentDailyBalance').text('');
    });

    $('.submitEditButton').click(function (event) {
        event.preventDefault();
        $(".submitEditButton").attr("disabled", true);
        $(".scanEditButton").attr("disabled", true);
        if (!$("#editRegisterTicketForm").isValid()) {
            if ($(".has-error").length) {
                let el = $('.has-error').first();
                if (!$.isEmptyObject(el)) {
                    $('html, body').animate({
                        scrollTop: (el.offset().top)
                    }, 10);
                }
            }
            $(".submitEditButton").attr("disabled", false);
            $(".scanEditButton").attr("disabled", false);
        }
        let initialId = $(".editInitialId").val();
        //let finalId = $(".editFinalId").val();
        if (initialId) {//if(initialId && finalId){
            // if(+initialId > +finalId){
            //    $(".submitEditButton").attr("disabled", false);
            //    $(".scanEditButton").attr("disabled", false);
            //    alert("Final Id Should be greater than Initial Id.");
            //    return;
            // }
            editPhysicalTickets();

            function editPhysicalTickets() {
                $.ajax({
                    type: "POST",
                    url: `/editPhysicalTickets`,
                    data: {
                        initialId: initialId,
                        //finalId: finalId,
                        hallId: $('#hallName').find(":selected").val(),
                        editColorId: $(".editTicketColorId").val()
                    },
                    success: function (response) {
                        console.log("response", response)
                        if (response.status == "success") {
                            $("#registerMoreTicketsuccessContainer").html(response.message);
                            $('#registerMoreTicketsuccessContainer').removeClass('hidden');
                            $("#registerMoreTicketsuccessContainer").show().delay(2000).fadeOut();

                            $('#editRegisterTicketForm')[0].reset();
                            setTimeout(function () {
                                $('#editModal').modal('toggle');
                            }, 3000);
                        } else {
                            $("#registerMoreTicketErrorContainer").html(response.message);
                            $('#registerMoreTicketErrorContainer').removeClass('hidden');
                            $("#registerMoreTicketErrorContainer").show().delay(2000).fadeOut();
                        }
                        let table = $("#registerMoreTicketTable").DataTable();
                        let selectedValue = $('#hallName').find(":selected").val();
                        if (selectedValue) {
                            table.ajax.url(host + "/getPhysicalTickets?hallId=" + selectedValue).load();
                        } else {
                            table.ajax.url(host + "/getPhysicalTickets").load();
                        }

                    },
                    complete: function (data) {
                        $(".submitEditButton").attr("disabled", false);
                        $(".scanEditButton").attr("disabled", false);
                        //$('#addPhysicalTicketForm')[0].reset();
                        //$('form:first *:input[type!=hidden]:first').focus();
                        let selectedValue = $('#hallName').find(":selected").val();
                        $('#addPhysicalTicketForm')[0].reset();
                        if (selectedValue) {
                            $('#hallName').val(selectedValue);
                        }
                        $(".initialId").focus();

                    },
                    error: function (d, s, e) {
                        console.log("error occured", d, s, e);
                    }
                });
            }

        } else {
            $(".submitEditButton").attr("disabled", false);
            $(".scanEditButton").attr("disabled", false);
        }
    });

    // Register More ticket with Edit
    //let gameId = null;
    let sellTicketGameId = null;
    function getNextGame() {
        console.log("getNextGame called")
        let nextGameName = $("#nextGameName").text();
        sellTicketGameId = $("#startGame").attr("data-nextgameid");
        console.log(sellTicketGameId);
        return nextGameName;
    }

    function updateNextGameName() {
        console.log("updateNextGameName called")
        let nextGameName = $("#nextGameName").text();
        if (nextGameName) {
            $("#nextGameNameInModal").text(`Game: ${nextGameName}`)
        }
    }

    // $("#registerSoldTicketsLink").click(function (e) {
    //     e.preventDefault();
    //     updateNextGameName();
    //     let table = $("#physicalTicketTable").DataTable();
    //     let currentGameId = $("#startGame").attr("data-nextgameid");
    //     if (currentGameId) {
    //         gameId = currentGameId;
    //         table.ajax.url(host + "/getSellPhysicalTickets/" + gameId).load();
    //     }
    //     $('#registerSoldTicketModal').modal('show');
    // });

    function updateOngoingGameName(){
        let ongoingGameName = $(".ongoingGameName").text();
        if (ongoingGameName) {
            $("#nextGameNameInModal").text(`Game: ${ongoingGameName}`);
            sellTicketGameId = $("#ongoingGameContainer").attr("data-ongoinggameid");
        }
    }

    $("#registerSoldTicketsLink, #registerSoldTicketsLinkOngoing").click(function (e) {
        e.preventDefault();
    
        const clickedId = this.id; // get the ID of the clicked element
        let gameIdToSellTicket = null;
    
        // Determine which game ID to use
        if (clickedId === "registerSoldTicketsLink") {
            updateNextGameName();
            gameIdToSellTicket = $("#startGame").attr("data-nextgameid");
            //gameIdToSellTicket && (gameId = gameIdToSellTicket);
        } else if (clickedId === "registerSoldTicketsLinkOngoing") {
            updateOngoingGameName();
            gameIdToSellTicket = $("#ongoingGameContainer").attr("data-ongoinggameid");
        }
        console.log("clickedId-", clickedId, gameIdToSellTicket)
        // Load data into DataTable if gameId is valid
        if (gameIdToSellTicket) {
            $("#physicalTicketTable").DataTable()
                .ajax.url(`${host}/getSellPhysicalTickets/${gameIdToSellTicket}`)
                .load();
    
            $('#registerSoldTicketModal').modal('show');
            sellTicketGameId = gameIdToSellTicket;
        }
    });


    $('#physicalTicketTable').DataTable({
        "oLanguage": {
            "sSearch": `${translate.search}`,
            "sLengthMenu": `${translate.show} _MENU_ ${translate.entries}`,
            "oPaginate": {
                sPrevious: `${translate.previous}`,
                sNext: `${translate.next}`
            },
            "sEmptyTable": `${translate.no_data_available_in_table}`,
            "sInfo": `${translate.showing} _START_ to _END_ of _TOTAL_ ${translate.entries}`,
            "sInfoEmpty": `${translate.showing} 0 to 0 of 0 ${translate.entries}`,
        },
        "bSort": false,
        "order": [[0, "desc"]],
        "columnDefs": [{
            "targets": [],
            "orderable": false,
        },
        { className: 'text-center', targets: [3] },
        ],
        "scrollX": false,
        "searching": false,
        "processing": true,
        //"serverSide": true,
        "autoWidth": false,
        //"pageLength": 10,
        "bLengthChange": false,
        "ajax": {
            url: host + "/getSellPhysicalTickets/" + sellTicketGameId,
            type: "GET",
            data: {
                gameId: sellTicketGameId,
            },
        },
        "columns": [
            { "data": "ticketColor" },
            {
                "data": "initialId",
                render: function (data, type, row) {
                    let initialId = ''
                    if (row.initialId) {
                        initialId = row.initialId;
                    }
                    return initialId;
                }
            },
            {
                "data": "finalId",
                render: function (data, type, row) {
                    let finalId = ''
                    if (row.finalId) {
                        finalId = row.finalId;
                    }
                    return finalId;
                }
            },
            {
                "data": "action",
                render: function (data, type, row) {
                    let html = '<div style="width : 100px !important;margin : 0 auto;text-align: center;">';

                    html += ` <button type="button" name="delete"  id="` + row.id + `"class="btn btn-danger btn-xs btn-delete deleteSellTicket" title="Delete Registered Tickets"><i class="fa fa-trash" aria-hidden="true"></i></button>`;

                    html += '</div>'
                    return html;

                }
            }
        ],
    });

    
    //$("#physicalTicketForm").submit(function( event ){
    $('body').on('click', '.submitButtonSoldTicket', function (event) {
        event.preventDefault();
        if ($("#physicalTicketForm").isValid() == true) {

        } else {
            if ($(".has-error").length) {
                let el = $('.has-error').first();
                if (!$.isEmptyObject(el)) {
                    $('html, body').animate({
                        scrollTop: (el.offset().top)
                    }, 10);
                }
            }
            return false;
        }
        $(".submitButtonSoldTicket").attr("disabled", true);
        $(".scanButtonSoldTicket").attr("disabled", true);
        let finalId = $(".finalIdSoldTicket").val();
        let hallId = $('#hallName').find(":selected").val();
        let agentId = $('#agentName').find(":selected").val();

        if (("{{session.role}}" == "admin" && finalId && hallId && agentId) || ("{{session.role}}" != "admin" && finalId)) {
            //getNextGame();
            $.ajax({
                type: "POST",
                url: `/addGamePhysicalTickets`,
                data: {
                    finalId: finalId,
                    gameId: sellTicketGameId,
                    hallId: $('#hallName').find(":selected").val(),
                    agentId: agentId
                },
                success: function (response) {
                    console.log("response", response)
                    if (response.status == "success") {
                        $(".alert-success-text").html(response.message);
                        $(".alertSuccess").show().delay(2000).fadeOut();
                        //let table = $("#physicalTicketTable").DataTable();
                        //table.ajax.url(host + "/getSellPhysicalTickets/"+gameId).load();
                    } else {
                        $(".alert-error-text").html(response.message);
                        $(".alertError").show().delay(2000).fadeOut();
                    }
                },
                complete: function (data) {
                    $(".submitButtonSoldTicket").attr("disabled", false);
                    $(".scanButtonSoldTicket").attr("disabled", false);
                    let selectedValue = $('#hallName').find(":selected").val();
                    let selectedAgentValue = $('#agentName').find(":selected").val();
                    $('#physicalTicketForm')[0].reset();
                    $('form:first *:input[type!=hidden]:first').focus();
                    if (selectedValue) {
                        $('#hallName').val(selectedValue);
                    }
                    if (selectedAgentValue) {
                        $('#agentName').val(selectedAgentValue);
                    }
                    let table = $("#physicalTicketTable").DataTable();
                    if (selectedValue) {
                        table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId + "?hallId=" + selectedValue + "&agentId=" + selectedAgentValue).load();
                    } else {
                        table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId).load();
                    }

                }
            });
        } else {
            $(".submitButtonSoldTicket").attr("disabled", false);
            $(".scanButtonSoldTicket").attr("disabled", false);
        }
    });

    $(document).on('keydown', function (event) {
        let activeTargetName = $('.custom-nav-tabs li.active a').data('target');
        let masterHallId = $("#masterHallId").val();
        console.log("Active Tab Target Name:", activeTargetName);
        // if ($('.modal:visible').length > 0) {
        //    event.preventDefault();
        //    return; 
        // }
        switch (event.which) {
            case 112: // F1 key
                event.preventDefault();
                if (activeTargetName == "agent") {
                    return;
                }
                if ($('.modal:visible').length > 0) {
                    return;
                }
                if (!isModalOpen) {
                    isModalOpen = true;

                    const $ongoingGameContainer = $("#ongoingGameContainer");
                    const $registerSoldTickets = $("#registerSoldTickets");
                    const $registerSoldTicketModal = $("#registerSoldTicketModal");
                    // If Ongoing game is there consider ongoing game id to sell tickets
                    let gameIdToSellTicket = $ongoingGameContainer.attr("data-ongoinggameid");
                    
                    if (gameIdToSellTicket) {
                        updateOngoingGameName();
                    } else if (getNextGame()) {
                        updateNextGameName();
                        gameIdToSellTicket = sellTicketGameId;
                    }

                    if (gameIdToSellTicket && !$registerSoldTickets.prop('disabled')) {
                        $("#physicalTicketTable").DataTable()
                            .ajax.url(`${host}/getSellPhysicalTickets/${gameIdToSellTicket}`)
                            .load();
                    
                        if ($registerSoldTicketModal.hasClass('show')) {
                            $registerSoldTicketModal.modal('dispose'); // Reset modal state
                        }
                    
                        $registerSoldTicketModal.modal('show');
                        sellTicketGameId = gameIdToSellTicket;
                    }
                }

                break;
            case 113: // F2 key
                event.preventDefault();
                if (activeTargetName == "agent") {
                    return;
                }
                if ($('#registerSoldTicketModal').hasClass('in')) {
                    $('.submitButtonSoldTicket').click();
                } else {
                    if ($('.modal:visible').length > 0) {
                        return;
                    }
                    if (!isModalOpen) {
                        isModalOpen = true;
                        if (getNextGame()) {
                            if ($("#registerMoreTickets").prop('disabled') == false) {
                                $("#registerMoreTicketTable").DataTable().ajax.url(`${host}/getPhysicalTickets`).load();
                                $('#registerMoreTicketModal').modal('show');
                            }

                        }
                    }

                }
                break;
            case 114: // F3 key
                event.preventDefault();
                if (activeTargetName == "agent") {
                    return;
                }

                console.log("Non master hall need to be ready, F3 called", masterHallId, hallId);
                if (masterHallId != hallId) {

                    let gameId = "";
                    let isReady = true;
                    let element = "";
                    if ($("#isAgentReadyOngoing").attr("data-ongoinggameid")) {
                        console.log("Yes");
                        gameId = $("#isAgentReadyOngoing").attr("data-ongoinggameid");
                        if ($("#isAgentReadyOngoing").attr("data-isready") == "Yes") {
                            isReady = false;
                        }
                        element = $("#isAgentReadyOngoing")[0];
                    } else {
                        console.log("No");
                        gameId = $("#isAgentReadyUpcoming").attr("data-nextgameid");
                        if ($("#isAgentReadyUpcoming").attr("data-isready") == "Yes") {
                            isReady = false;
                        }
                        element = $("#isAgentReadyUpcoming")[0];
                    }

                    console.log("gameId, agentId and hallId", gameId, hallId, isReady, element);
                    if (gameId) {
                        console.log("call update hall status")
                        updateHallStatus({ gameId: gameId, isReady: isReady, element: element })
                    }
                } else {
                    //swal("Failed!", "Master hall don't Need to perform this action.", "error");
                }
                break;
            case 13: // Enter key
                event.preventDefault();
                if ($('#uniqueIdFinancialModal').hasClass('in')) {
                    $("#uniqueIdFinancialSubmitBtn").click();
                } else if ($('#registerUserFinancialModal').hasClass('in')) {
                    $("#registerUserFinancialSubmitBtn").click();
                }  else if ($('#checkForBingoModal').hasClass('in')) {
                    $(".checkForBingo").click();
                }
                break;
            case 32: // Space key
                event.preventDefault();
                process_manual_tickets_entry();
                break;
            case 115: // F4 key
                event.preventDefault();
                if (activeTargetName == "game") {
                    return;
                }
                if ($('.modal:visible').length > 0) {
                    return;
                }
                if ($("#addMoneyUniqueId").prop('disabled') == false) {
                    if (!isModalOpen) {
                        isModalOpen = true;
                        openUniqueIdModal('Add Money - Unique Id', 'add', 'Add', true);
                    }
                }
                break;
            case 116: // F5 key
                event.preventDefault();
                if (activeTargetName == "game") {
                    return;
                }
                if ($('.modal:visible').length > 0) {
                    return;
                }
                if ($("#addMoneyUser").prop('disabled') == false) {
                    if (!isModalOpen) {
                        isModalOpen = true;
                        openRegisterUserdModal('Add Money - Register User', 'add', 'Add');
                    }
                }
                break;
            case 117: // F6 key
                event.preventDefault();
                if (activeTargetName == "game") {
                    return;
                }
                if ($('.modal:visible').length > 0) {
                    return;
                }
                if ($("#withdrawUser").prop('disabled') == false) {
                    if (!isModalOpen) {
                        isModalOpen = true;
                        openRegisterUserdModal('Withdraw Money - Register User', 'withdraw', 'Withdraw');
                    }
                }
                break;
            case 119: // F8 key
                event.preventDefault();
                console.log("f8 called")
                $('#hallSpecificReportLink')[0].click();
                break;
            case 120: // F9 key
                event.preventDefault();

                break;
            case 121: // F10 key
            case 122: // F10, F11 Key to pause game and check for bingo
                event.preventDefault();
                // Decide which button to click based on key pressed
                const isF10 = event.which === 121;
                const $pauseGameButton = isF10
                    ? $("#pauseGameWithoutAnnouncement")
                    : $("#pauseGame");
                const ongoingGameId = $pauseGameButton.attr("data-ongoinggameid");
                if (masterHallId === hallId) {
                    if (ongoingGameId) {
                        $pauseGameButton[0].click(); // Click the pause game button if ongoingGameId exists
                    }
                } else if(!isF10) { // If not F10, then check for bingo
                    const bingoButtonId = $(".checkBingoComgame").attr("id");
                    if (bingoButtonId) {
                        const ongoingLatestGameId = $("#ongoingGameContainer").attr("data-ongoinggameid");
                        if (ongoingLatestGameId) {
                            $(".pauseGameId").val(bingoButtonId); // Set the value of pauseGameId
                            $("#checkForBingoModal").modal('show'); // Show the modal
                        }
                    }
                }
                break;
            case 123: // F12 Key to Resume Game
                event.preventDefault();
                if (masterHallId === hallId) {
                    const ongoingLatestGameId = $("#ongoingGameContainer").attr("data-ongoinggameid");
                    if (ongoingLatestGameId) {
                        console.log("resume game called");
                        $("#resumeGame")[0].click();
                    } else {
                        console.log("start game called");
                        $("#startGame")[0].click();
                    }
                }
                break;

            default:
                break;
        }
    });

    // Custom ESC key handler for modals, to close the topmost open modal on ESC key so that popup closes one by one
    (function ($) {
        $(function () {
          // 1) Remove Bootstrap's built-in ESC handler (namespaced) so it won't double-close.
          $(document).off('keyup.dismiss.bs.modal');
      
          // 2) Manage z-index for stacked modals and disable per-modal keyboard option
          $(document).on('show.bs.modal', '.modal', function () {
            var $this = $(this);
            var openCount = $('.modal.in').length; // currently open modals
            var zIndex = 1040 + (10 * openCount);
            $this.css('z-index', zIndex);
      
            // bump backdrop z-index and mark it so we don't re-adjust existing ones
            setTimeout(function () {
              $('.modal-backdrop').not('.modal-stack').css('z-index', zIndex - 1).addClass('modal-stack');
            }, 0);
      
            // ensure Bootstrap won't attach its own keyboard handler for this instance
            var modalData = $this.data('bs.modal');
            if (modalData && modalData.options) {
              modalData.options.keyboard = false;
            }
          });
      
          // ensure the shown modal gets focus
          $(document).on('shown.bs.modal', '.modal', function () {
            $(this).focus();
          });
      
          // 3) Global handler: close only the topmost open modal on ESC
          $(document).on('keyup', function (e) {
            if (e.which !== 27) return; // ESC key
            var $top = $('.modal.in:visible').last(); // topmost
            if (!$top.length) return;
      
            e.preventDefault();
            e.stopImmediatePropagation(); // prevent any other handlers
            $top.modal('hide');
          });
      
          // 4) After a modal hides, restore focus to the next modal underneath (if any)
          $(document).on('hidden.bs.modal', '.modal', function () {
            var $next = $('.modal.in:visible').last();
            if ($next.length) {
              // focus the underlying modal so keyboard/ESC remains usable
              $next.focus();
            } else {
              // no modals left — ensure body does not keep modal-open class
              $('body').removeClass('modal-open');
            }
      
            // tidy up any invisible backdrops left behind
            setTimeout(function () {
              $('.modal-backdrop').filter(function () {
                return $(this).css('display') === 'none';
              }).remove();
            }, 200);
          });
        });
    })(jQuery);
      


    $('body').on('click', '.deleteSellTicket', function (e) {
        let id = $(this).attr('id');
        let thisElement = this;
        swal({
            title: `${translate.sure_want_to_delete_physical_ticket}?`,
            text: `${translate.not_be_able_to_recover_physical_ticket}!`,
            type: "warning",
            showCancelButton: true,
            confirmButtonColor: "#e69a2a",
            confirmButtonText: `${translate.delete_button}`,
            cancelButtonText: `${translate.cancel_button}`,
            closeOnConfirm: false,
            closeOnCancel: false
        }, function (isConfirm) {
            if (isConfirm) {
                $.ajax({
                    type: 'POST',
                    url: host + "/deleteSellPhysicalTicket",
                    data: {
                        id: id,
                        gameId: sellTicketGameId,
                        hallId: $('#hallName').find(":selected").val(),
                        agentId: $('#agentName').find(":selected").val()
                    },
                    success: function (resultData) {
                        if (resultData == 'success') {
                            let selectedValue = $('#hallName').find(":selected").val();
                            let selectedAgentValue = $('#agentName').find(":selected").val();
                            let table = $("#physicalTicketTable").DataTable();
                            if (selectedValue) {
                                table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId + "?hallId=" + selectedValue + "&agentId=" + selectedAgentValue).load();
                            } else {
                                table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId).load();
                            }
                            swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}`, "success");
                        } else {
                            alert("Something went wrong")
                        }
                    }
                });
                swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}`, "success");
            } else {
                swal(`${translate.cancelled}`, `${translate.physical_ticket_not_deleted}`, "error");
            }
        });
        return false;
    });


    $('body').on('click', '.cancelPhysicalTickets', function (e) {
        let role = "{{session.role}}";
        if (role == "admin") {
            $('#registerSoldTicketModal').modal('toggle');
            return false;
        }
        let id = $(this).attr('id');
        let thisElement = this;
        let ticketsCount = $('#physicalTicketTable').DataTable().rows().count();
        if (ticketsCount <= 0) {
            $('#registerSoldTicketModal').modal('toggle');
            return false;
        }
        swal({
            title: `${translate.sure_want_to_remove_all_physical_ticket}?`,
            text: `${translate.not_be_able_to_recover_physical_ticket}!`,
            type: "warning",
            showCancelButton: true,
            confirmButtonColor: "#e69a2a",
            confirmButtonText: `${translate.delete_button}`,
            cancelButtonText: `${translate.cancel_button}`,
            closeOnConfirm: false,
            closeOnCancel: false
        }, function (isConfirm) {
            if (isConfirm) {
                $.ajax({
                    type: 'POST',
                    url: host + "/deleteAllSellPhysicalTicket",
                    data: {
                        id: id,
                        gameId: sellTicketGameId
                    },
                    success: function (resultData) {
                        if (resultData == 'success') {
                            let table = $("#physicalTicketTable").DataTable();
                            table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId).load();
                            swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}.`, "success");
                            $('#registerSoldTicketModal').modal('toggle');
                        } else {
                            alert(`${translate.Something_went_wrong}`)
                        }
                    }
                });
                swal(`${translate.deleted}`, `${translate.physical_ticket_deleted_success}.`, "success");
            } else {
                swal(`${translate.cancelled}`, `${translate.physical_ticket_not_deleted}`, "error");
            }
        });
        return false;
    });


    $('body').on('click', '.purchasePhysicalTickets', function (e) {
        e.preventDefault();
        $(".purchasePhysicalTickets").attr("disabled", true);
        $(".cancelPhysicalTickets").attr("disabled", true);
        let finalId = $(".finalIdSoldTicket").val();
        let hallId = $('#hallName').find(":selected").val();
        let agentId = $('#agentName').find(":selected").val();

        if (("{{session.role}}" == "admin" && hallId && agentId) || ("{{session.role}}" != "admin" && sellTicketGameId)) {
            $.ajax({
                type: "POST",
                url: `/purchasePhysicalTickets`,
                data: {
                    gameId: sellTicketGameId,
                    hallId: hallId,
                    agentId: agentId
                },
                success: function (response) {
                    console.log("response", response)
                    if (response.status == "success") {
                        $(".alert-success-text").html(response.message);
                        $(".alertSuccess").show().delay(2000).fadeOut();
                        if (response.dailyBalance) {
                            $("#rootChips").text(parseFloat(response.dailyBalance).toFixed(2));
                        }
                        window.location.reload();
                    } else {
                        $(".alert-error-text").html(response.message);
                        $(".alertError").show().delay(2000).fadeOut();
                    }
                },
                complete: function (data) {
                    $(".purchasePhysicalTickets").attr("disabled", false);
                    $(".cancelPhysicalTickets").attr("disabled", false);
                    let selectedValue = $('#hallName').find(":selected").val();
                    let selectedAgentValue = $('#agentName').find(":selected").val();
                    if (selectedValue) {
                        $('#hallName').val(selectedValue);
                    }
                    if (selectedAgentValue) {
                        $('#agentName').val(selectedAgentValue);
                    }
                    let table = $("#physicalTicketTable").DataTable();
                    if (selectedValue) {
                        table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId + "?hallId=" + selectedValue + "&agentId=" + selectedAgentValue).load();
                    } else {
                        table.ajax.url(host + "/getSellPhysicalTickets/" + sellTicketGameId).load();
                    }
                }
            });
        } else {
            $(".purchasePhysicalTickets").attr("disabled", false);
            $(".cancelPhysicalTickets").attr("disabled", false);
        }
        //return false;
    });

    // Active Inactive Hall
    $("#isAgentReadyUpcoming, #isAgentReadyOngoing").on('click', function (e) {
        e.preventDefault();
        let masterHallId = $("#masterHallId").val();
        console.log("Non master hall need to be ready", masterHallId, hallId);
        if (masterHallId != hallId) {
            let element = this;
            let gameId = "";
            if (this.id == "isAgentReadyOngoing") {
                gameId = $(this).attr("data-ongoinggameid")
            } else {
                gameId = $(this).attr("data-nextgameid")
            }

            let isReady = true;
            if ($(this).attr("data-isready") == "Yes") {
                isReady = false;
            }

            console.log("gameId, agentId and hallId", gameId, hallId, isReady, element);
            if (gameId) {
                updateHallStatus({ gameId: gameId, isReady: isReady, element: element })
            }
        } else {
            swal("Failed!", "Master hall don't Need to perform this action.", "error");
        }

    });

    //Pause game
    $(".pauseGameBtnClass").on('click', function (e) {
        e.preventDefault();
        const $pauseGameBtn = $(this);
        const $bingoModal = $("#checkForBingoModal");
        const isPauseWithoutAnnouncement = $pauseGameBtn.attr("id") == "pauseGameWithoutAnnouncement";
        console.log("isPauseWithoutAnnouncement", isPauseWithoutAnnouncement)
        $(".checkForBingo").prop("disabled", false);
        $pauseGameBtn.attr("disabled", true);

        $.ajax({
            type: 'GET',
            url: host + "/agent/game/status/pause",
            success: function (resultData) {
                console.log("resultData of pause game check", resultData)

                if (resultData.status !== "success") {
                    $pauseGameBtn.attr("disabled", false);
                    return swal(`${translate.failed}`, resultData.message, "error");
                }

                if (!resultData.isGameAvailable) {
                    $pauseGameBtn.attr("disabled", false);
                    return swal(`${translate.failed}`, `${translate.theres_no_ongoing_game_to_stop_at_the_moment}`, "error");
                }

                $(".pauseGameId").val(resultData.runningGame.id);

                if (resultData.isGamePaused) {
                    console.log("Game is already paused, opening ticket search...");
                    $pauseGameBtn.attr("disabled", false);
                    //return $bingoModal.modal("show");
                    isPauseWithoutAnnouncement === false && showModalIfNotOpen($bingoModal);
                    return;
                }

                // Pause the game
                $.ajax({
                    url: "/agent/game/stop",
                    method: "POST",
                    data: { id: resultData.runningGame.id, isPauseWithoutAnnouncement: isPauseWithoutAnnouncement },
                    success: function (response) {
                        console.log("Game pause response:", response);

                        if (response.status === "success") {
                            console.log("Game paused successfully, opening search...");
                            //return $bingoModal.modal("show");
                            isPauseWithoutAnnouncement === false && showModalIfNotOpen($bingoModal);
                            return;
                        }

                        if (!response.showSearch) {
                            swal(`${translate.failed}`, response.message, "error");
                        } else {
                            console.log("Opening search...");
                            //$bingoModal.modal("show");
                            isPauseWithoutAnnouncement === false && showModalIfNotOpen($bingoModal);
                            return;
                        }
                    },
                    complete: function () {
                        $pauseGameBtn.attr("disabled", false);
                    },
                });
            },
            error: function (d, s, e) {
                console.log("error occured", s, e);
                $pauseGameBtn.attr("disabled", false);
            }
        });
    });

    // Resume Game
    $("#resumeGame, #startGame").on("click", function (e) {
        e.preventDefault();

        const operationId = this.id;
        const jackpotDraw = $(this).data("jackpotdraw");
        const jackpotPrizeValues = $(this).data("jackpotprize");
        const $operationBtn = $(`#${operationId}`);

        // Disable button to prevent multiple clicks
        $operationBtn.attr("disabled", true);

        // Get game ID based on operation
        const id = operationId === "startGame"
            ? $("#startGame").attr("data-nextgameid")
            : $("#resumeGame").attr("data-ongoingGameId");

        // Fetch game status
        $.ajax({
            type: "GET",
            url: `${host}/agent/game/status/start`,
            data: { id, operationId },
            success: function (resultData) {
                console.log("Game status response:", resultData);

                if (resultData.status !== "success") {
                    handleGameFailure(resultData, operationId);
                    return;
                }

                if (!resultData.isGameAvailable || !resultData.runningGame) {
                    enableButton(operationId);
                    showError(`${translate.theres_no_game_available_to_resume}.`);
                    return;
                }

                if (resultData.isGamePaused || resultData.runningGame?.status === "active") {
                    const gameAction = resultData.runningGame?.status === "active"
                        ? "Start"
                        : resultData.isGamePaused
                            ? "Resume"
                            : null;
                    if (gameAction) {
                        if (gameAction === "Start") {
                            const nextGameName = $("#nextGameName").text();
                            console.log("nextGameName:", nextGameName, jackpotDraw, jackpotPrizeValues);
                            if (nextGameName === "Jackpot" && jackpotDraw && jackpotPrizeValues) {
                                let jackpotSelectedColors = resultData.jackpotSelectedColors;
                                ["Yellow", "White", "Purple"].forEach(color => {
                                    if (!jackpotSelectedColors.includes(color)) {
                                        jackpotPrizeValues[color.toLowerCase()] = 0;
                                    }
                                });
                                handleJackpotModal(jackpotDraw, jackpotPrizeValues, "#confirmJackpotModal", operationId);
                                return;
                            }
                            if (nextGameName === "Innsatsen" && jackpotDraw) {
                                handleJackpotModal(jackpotDraw, null, "#confirmInnsatsenJackpotModal", operationId);
                                return;
                            }
                        }

                        console.log("Game Action:", gameAction);
                        startOrResumeGame(resultData.runningGame?._id, gameAction, operationId);
                    } else {
                        enableButton(operationId);
                        showError(`${translate.game_is_already_running}.`);
                    }
                } else {
                    enableButton(operationId);
                    showError(`${translate.game_is_already_running}.`);
                }
            },
            error: function (xhr, status, error) {
                console.log("Error occurred:", status, error);
                $operationBtn.attr("disabled", false);
            },
        });
    });

    // Handles jackpot modal values and toggles modal.
    function handleJackpotModal(jackpotDraw, jackpotPrizeValues, modalId, operationId) {
        if(modalId == "#confirmInnsatsenJackpotModal") {
            $(".InnsatsenJackpotDrawModal").val(jackpotDraw);
        }else{  
            $(".jackpotDrawModal").val(jackpotDraw);
        }
        if (jackpotPrizeValues) {
            $(".jackpotPrizeYellowModal").val(+jackpotPrizeValues.yellow);
            $(".jackpotPrizeWhiteModal").val(+jackpotPrizeValues.white);
            $(".jackpotPrizePurpleModal").val(+jackpotPrizeValues.purple);
            // call jackpot validation
            updateJackpotValidation(jackpotPrizeValues);
        }
        
        $(modalId).modal("toggle");
        enableButton(operationId)
    }

    // Sends a request to start or resume the game.
    function startOrResumeGame(gameId, gameAction, operationId) {
        $.ajax({
            url: "/agent/game/start",
            method: "POST",
            data: {
                id: gameId,
                gameAction,
                hostUrl: window.location.origin,
                operationId
            },
            success: function (response) {
                console.log("Game start/resume response:", response);
                if (response.status === "success") {
                    console.log("Game started or resumed successfully:", response.message);
                } else {
                    handleGameFailure(response);
                }
            },
            complete: function () {
                enableButton(operationId)
            }
        });
    }

    // Handle Game Start/Resume Failure
    function handleGameFailure(resultData, operationId) {
        enableButton(operationId);
        let failureMessage = resultData.message;
        if (resultData.result?.date) {
            const userLocalDate = moment(resultData.result.date).local().format("DD/MM/YYYY HH:mm a");
            failureMessage += ` ${userLocalDate}`;
        }
        showError(failureMessage);
    }

    // Enable Button
    function enableButton(operationId) {
        $(`#${operationId}`).attr("disabled", false);
    }
    // Show Error Message
    function showError(message) {
        swal(`${translate.failed}!`, message, "error");
    }
    // Resume game complete

    function updateHallStatus(data) {
        const { gameId, isReady, element } = data;
        $.ajax({
            type: 'POST',
            url: host + "/agent/game/update-hall-status",
            data: {
                'gameId': gameId,
                isReady: isReady
                //'agentId': agentId
            },
            success: function (resultData) {
                if (resultData.status == "success") {
                    if (resultData.isHallReady == false) {
                        console.log("in false")
                        //$(element).removeClass("btn-success").text(`${translate.are_you_ready}`);
                        //$(element).addClass("btn-warning");
                        $(element).text(`${translate.are_you_ready} (F3)`);
                        $(element).attr("data-isready", "No");
                    } else {
                        console.log("in trur")
                        //$(element).removeClass("btn-warning").text(`${translate.ready_to_go}`);
                        //$(element).addClass("btn-success");
                        $(element).text(`${translate.ready_to_go} (F3)`);
                        $(element).attr("data-isready", "Yes");
                    }
                    $(element).removeClass("btn-warning btn-success btn-danger").addClass(resultData.currentHallClass); // Add the new class and remove other
                } else {
                    swal({
                        title: "Fail.",
                        text: `${translate.Something_went_wrong}`, //"Something went wrong while updating Hall status",
                        type: "error"
                    })
                }
            }
        })
    }

    // Add/withdraw unique id 
    function openUniqueIdModal(title, action, buttonText, showCardOption) {
        console.log("openUniqueIdModal called")
        buttonText = buttonText.toLowerCase()
        let buttonText1 = translate[buttonText];
        console.log("buttonText1---", buttonText1)
        $('#uniqueIdFinancialModalLabel').text(title);
        $('#uniqueIdFinancialAction').val(action);
        $('#uniqueIdFinancialSubmitBtn').text(`${buttonText1} (Enter)`);

        const validationUrl = '/agent/unique-id/check-validity?action=' + action;
        $('#uniqueId').attr('data-validation-url', validationUrl);

        // Toggle the Card payment option based on the action (Add Money should show Card, Withdraw should not)
        if (showCardOption) {
            $('#uniqueIdFinancialCardOption').show();
        } else {
            $('#uniqueIdFinancialCardOption').hide();
        }
        $('#uniqueIdFinancialModal').modal('show'); // Show the modal
    }

    let typingTimer;
    const typingInterval = 500; // 0.5 seconds delay

    $('#uniqueId').on('keyup', function () {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(function () {
            const uniqueId = $('#uniqueId').val();
            if (uniqueId) {
                getUniqueUserBalance(uniqueId);
            } else {
                $('#balanceResult').text('');
            }
        }, typingInterval);
    });

    $('#uniqueId').on('keydown', function () {
        clearTimeout(typingTimer);
    });

    $('#uniqueId').on('blur', function () {
        clearTimeout(typingTimer);
        const uniqueId = $('#uniqueId').val();
        if (uniqueId) {
            getUniqueUserBalance(uniqueId);
        } else {
            $('#balanceResult').text('');
        }
    });

    function getUniqueUserBalance(uniqueId) {
        const action = $('#uniqueIdFinancialAction').val();
        $.ajax({
            url: '/agent/unique-id/balance/get',
            method: 'GET',
            data: { uniqueId: uniqueId, action: action },
            success: function (response) {
                if (response.status == "success") {
                    $('#balanceResult').text(`${translate.current_balance}: ${response.balance} Kr`).css('color', 'green');

                } else {
                    $('#balanceResult').text(response.message).css('color', 'red');
                    $('#balanceResult').text('');
                }
            },
        });
    }

    $("#uniqueIdBalanceForm").submit(function (event) {
        event.preventDefault();
        console.log("uniqueIdFinancialAmount---", $('#uniqueIdFinancialAmount').val())
        if ($("#uniqueIdBalanceForm").isValid() == true) {
            $.ajax({
                url: '/agent/unique-id/balance/update',
                method: 'POST',
                data: {
                    uniqueId: $('#uniqueId').val(),
                    amount: $('#uniqueIdFinancialAmount').val(),
                    paymentType: $('#paymentType').val(),
                    action: $('#uniqueIdFinancialAction').val(),
                },
                success: function (response) {
                    if (response.status == "success") {
                        if (response?.paymentType.toLowerCase() == "cash") {
                            $("#rootChips").text(parseFloat(response.dailyBalance).toFixed(2));
                        }
                        $('#uniqueIdSuccessContainer').html(response.message);
                        $('#uniqueIdSuccessContainer').removeClass('hidden');

                        setTimeout(function () {
                            $('#uniqueIdSuccessContainer').addClass('hidden');
                            $('#uniqueIdFinancialModal').modal('hide');
                        }, 2000);

                    } else {
                        $('#uniqueIdErrorContainer').html(response.message);
                        $('#uniqueIdErrorContainer').removeClass('hidden');

                        setTimeout(function () {
                            $('#uniqueIdErrorContainer').addClass('hidden');
                        }, 5000);
                    }
                }, complete: function () {
                    $("#uniqueIdBalanceForm")[0].reset();
                    $('#balanceResult').text('');
                }
            });
            return false;
        } else {
            if ($(".has-error").length) {
                let el = $('.has-error').first();
                if (!$.isEmptyObject(el)) {
                    $('html, body').animate({
                        scrollTop: (el.offset().top)
                    }, 10);
                }
            }
        }

    });

    // Add/Withdraw Register user
    function openRegisterUserdModal(title, action, buttonText) {
        buttonText = buttonText.toLowerCase()
        let buttonText1 = translate[buttonText];
        console.log("buttonText1---", buttonText1)
        $('#registerUserFinancialModalLabel').text(title);
        $('#registerUserFinancialAction').val(action);
        $('#registerUserFinancialSubmitBtn').text(`${buttonText1} (Enter)`);
        $('#registerUserFinancialModal').modal('show'); // Show the modal
    }

    // $.formUtils.addValidator({
    //     name: 'username_server',
    //     validatorFunction: function (value, $el, config, language, $form) {
    //         let isValid = false;
    //         $.ajax({
    //             url: '/agent/player/check-validity',
    //             type: 'POST',
    //             data: { userName: value },
    //             async: false,
    //             success: function (response) {
    //                 isValid = response.valid; // Update isValid based on response
    //                 if (isValid) {
    //                     $el.removeClass('error').addClass('valid'); // Remove error class and add valid class
    //                     $el.closest('.form-group').removeClass('has-error');
    //                     $el.removeAttr('style');
    //                     $el.next('.form-error').remove(); // Remove any existing error messages
    //                 } else {
    //                     $el.removeClass('valid').addClass('error'); // Add error class
    //                     $el.closest('.form-group').addClass('has-error');
    //                 }
    //             },
    //             error: function () {
    //                 console.log("error")
    //                 isValid = false; // Handle error
    //             }
    //         });
    //         return isValid;
    //     },
    //     // errorMessage: 'Please enter valid username.',
    //     borderColorOnError: '#dc3545'
    // });
    let debounceTimer; // Global debounce timer
    let lastValue = ""; // Track previous input value

    // Bind event for #machine_username
    $("#addToWallet_username").on("input", function () {
        let value = $(this).val().trim();
        let suggestionContainer = $("#addToWalletUsernameSuggestions");

        clearTimeout(debounceTimer);
        lastValue = value;

        debounceTimer = setTimeout(function () {
            checkUsernameValidity(value, suggestionContainer);
        }, 300);
    });

    // Bind event for #machine_username
    $("#machine_username").on("input", function () {
        let value = $(this).val().trim();
        let suggestionContainer = $("#usernameSuggestions");

        clearTimeout(debounceTimer);
        lastValue = value;

        debounceTimer = setTimeout(function () {
            checkUsernameValidity(value, suggestionContainer);
        }, 300);
    });

    // Bind event for #registerUserFinancialUserName
    $("#registerUserFinancialUserName").on("input", function () {
        let value = $(this).val().trim();
        let suggestionContainer = $("#addMoneyUsernameSuggestions");

        clearTimeout(debounceTimer);
        lastValue = value;

        debounceTimer = setTimeout(function () {
            checkUsernameValidity(value, suggestionContainer);
        }, 300);
    });

    function checkUsernameValidity(value, suggestionContainer) {
        $.ajax({
            url: '/agent/player/check-validity',
            type: 'POST',
            data: { userName: value },
            success: function (response) {
                console.log("API Response:", response);
                $('.registerUserStats').html(''); // Clear User stats html
                suggestionContainer.empty().hide(); // Always clear and hide first

                if (response.valid && response.valid.length > 0) {
                    response.valid.forEach(function (suggestedName) {
                        let suggestionItem = $("<div class='suggestion-item'></div>")
                            .text(`${suggestedName.username} / ${suggestedName.customerNumber} / ${suggestedName.phone}`)
                            .css({
                                "color": "#007bff", // Blue color
                                "font-size": "16px",
                                "padding": "5px 10px",
                                "cursor": "pointer",
                                "border-bottom": "1px solid #ddd"
                            });
                
                        suggestionItem.on("click", function () {
                            let selectedUsername = suggestedName.username;
                            let inputField = suggestionContainer.siblings("input"); // Get the associated input field
                
                            inputField.val(selectedUsername);
                            suggestionContainer.empty().hide();
                
                            // Call API to get user balance
                            getUSerBalance(selectedUsername, inputField);
                        });
                
                        suggestionContainer.append(suggestionItem);
                    });
                
                    suggestionContainer.show();
                } else {
                    suggestionContainer.hide(); // Hide if no suggestions
                    
                }
                // Manually trigger validation after API call
                suggestionContainer.siblings("input").validate();
            },
            error: function () {
                console.log("Error fetching suggestions");
            }
        });
    }

    // ✅ Register Validator
    $.formUtils.addValidator({
        name: 'username_server',
        validatorFunction: function (value, $el, config, language, $form) {
            return true; // Allow empty values to be validated
        },
        errorMessage: 'Invalid username. Please choose another.',
        borderColorOnError: '#dc3545'
    });

    // ✅ Initialize Form Validation AFTER the validator is registered
    $.validate({
        modules: 'security',
        validateOnBlur: true,
    });


    // Debounce function to limit the rate of validation checks
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Manual validation function
    function validateUsername() {
        var $input = $('.financialUserName');
        $input.each(function () {
            $.formUtils.validateInput($(this)); // Trigger validation manually for each input
        });
    }

    // Trigger validation on input change with debounce
    const validateInput = debounce(validateUsername, 1000); // Adjust debounce delay as needed

    $('.financialUserName').on('input', validateInput);

    $('.financialUserName').on('keyup', function () {
        clearTimeout(typingTimer);
        const self = $(this);
        typingTimer = setTimeout(function () {
            const username = self.val();
            if (username) {
                getUSerBalance(username, self);
            } else {
                $('.registerUserFinancialBalanceResult').text('');
                $('.playerIdOfUsername').val('');
            }
        }, typingInterval);
    });

    $('.financialUserName').on('keydown', function () {
        clearTimeout(typingTimer);
    });

    $('.financialUserName').on('blur', function () {
        clearTimeout(typingTimer);
        const username = $(this).val();
        if (username) {
            getUSerBalance(username, $(this));
        } else {
            $('.registerUserFinancialBalanceResult').text('');
            $('.playerIdOfUsername').val('');
        }
    });

    function getUSerBalance(username, inputElement) {
        const action =  $("#registerUserFinancialAction").val(); // add or withdraw used to get all details in add user
        $.ajax({
            url: '/agent/register-user/balance/get',
            method: 'GET',
            data: { username: username, action: action },
            success: function (response) {
                const playerIdField = inputElement.closest('.form-group').find('.playerIdOfUsername');
                if (response.status == "success") {
                    if (action === "add" && response.addUserStats) {
                        // Build a table or list of stats
                        const stats = response.addUserStats;
                        // Define the fields and their display names
                        const statFields = [
                            { key: "balance", label: translate.current_balance || "Current Balance", suffix: "Kr" },
                            { key: "totalDeposits", label: translate.total_deposits || "Total Deposits", suffix: "Kr" },
                            { key: "totalWithdrawals", label: translate.total_withdrawals || "Total Withdrawals", suffix: "Kr" },
                            { key: "totalTicketPurchases", label: translate.total_ticket_purchases || "Total Ticket Purchases", suffix: "Kr" },
                            { key: "totalWinning", label: translate.total_winning || "Total Winning", suffix: "Kr" },
                            { key: "totalProfitLoss", label: `${translate.total} ${translate.profit}/${translate.loss}` || "Total Profit/Loss", suffix: "Kr" },
                            { key: "remainingDailyLimit", label: `${translate.remaining_daily_limit}` || "Remaining Daily Limit",  },
                            { key: "remainingMonthlyLimit", label: `${translate.remaining_monthly_limit}` || "Remaining Monthly Limit", }
                        ];
                        let html = `<table class="user-stats-table" style="margin:0 auto;">`;
                        statFields.forEach(f => {
                            if (stats[f.key] !== undefined) {
                                html += `<tr>
                                    <th style="padding:4px 12px;text-align:right;">${f.label}</th>
                                    <td style="padding:4px 12px;text-align:left;">${stats[f.key]}${f.suffix ? ' ' + f.suffix : ''}</td>
                                </tr>`;
                            }
                        });
                        html += `</table>`;
                        $('.registerUserStats').html(html).css('color', 'inherit');
                    } else {
                        $('.registerUserFinancialBalanceResult').text(`${translate.current_balance}: ${response.balance} Kr`).css('color', 'green');
                    }
                    playerIdField.val(response.playerId); //$("#playerIdOfUsername").val(response.playerId)
                } else {
                    $('.registerUserFinancialBalanceResult').text(response.message).css('color', 'red');
                    $('.registerUserFinancialBalanceResult').text('');
                    $('.registerUserStats').html('');
                    playerIdField.val(""); //$("#playerIdOfUsername").val("")
                }
            },
        });
    }

    $("#registerUserBalanceForm").submit(function (event) {
        event.preventDefault();
        if ($("#registerUserBalanceForm").isValid() == true) {
            $.ajax({
                url: '/agent/register-user/balance/update',
                method: 'POST',
                data: {
                    username: $('#registerUserFinancialUserName').val(),
                    amount: $('#registerUserFinancialAmount').val(),
                    paymentType: $('#registerUserFinancialPaymentType').val(),
                    action: $('#registerUserFinancialAction').val(),
                    id: $("#playerIdOfUsername").val(),
                },
                success: function (response) {
                    console.log("response of update user balance", response)
                    if (response.status == "success") {
                        if (response?.paymentType.toLowerCase() == "cash") {
                            $("#rootChips").text(parseFloat(response.dailyBalance).toFixed(2));
                        }
                        $('#registerUserSuccessContainer').html(response.message);
                        $('#registerUserSuccessContainer').removeClass('hidden');
                        setTimeout(function () {
                            $('#registerUserSuccessContainer').addClass('hidden');
                            $('#registerUserFinancialModal').modal('hide');
                        }, 2000);
                    } else {
                        $('#registerUserErrorContainer').html(response.message);
                        $('#registerUserErrorContainer').removeClass('hidden');

                        setTimeout(function () {
                            $('#registerUserErrorContainer').addClass('hidden');
                        }, 5000);
                    }
                }, complete: function () {
                    $("#registerUserBalanceForm")[0].reset();
                    $('.registerUserFinancialBalanceResult').text('');
                    $("#playerIdOfUsername").val("");
                    $('.registerUserStats').html('');
                }
            });
            return false;
        } else {
            if ($(".has-error").length) {
                let el = $('.has-error').first();
                if (!$.isEmptyObject(el)) {
                    $('html, body').animate({
                        scrollTop: (el.offset().top)
                    }, 10);
                }
            }
        }

    });


    $('#registerMoreTicketModal').on('hidden.bs.modal', function () {
        isModalOpen = false;
    });

    $('#registerSoldTicketModal').on('hidden.bs.modal', function () {
        isModalOpen = false;
    });

    $('#uniqueIdFinancialModal').on('hidden.bs.modal', function () {
        isModalOpen = false;
        $("#uniqueIdBalanceForm")[0].reset();
        $('#balanceResult').text('');
    });

    $('#registerUserFinancialModal').on('hidden.bs.modal', function () {
        isModalOpen = false;
        $("#registerUserBalanceForm")[0].reset();
        $('.registerUserFinancialBalanceResult').text('');
        $('#registerUserBalanceForm input[type="hidden"]').val(''); // Clear hidden fields manually
        $('.registerUserStats').html('');
    });

    function openUpcomingGameModal(parentGameId) {
        if (!$.fn.DataTable.isDataTable('#upcomingGamesTable')) {
            console.log("upcomingGamesTable called if")
            $('#upcomingGamesTable').DataTable({
                "oLanguage": {
                    "sSearch": `${translate.search_by_game_name}`,
                    "sLengthMenu": `${translate.show} _MENU_ ${translate.entries}`,
                    "oPaginate": {
                        sPrevious: `${translate.previous}`,
                        sNext: `${translate.next}`
                    },
                    "sEmptyTable": `${translate.no_data_available_in_table}`,
                    "sInfo": `${translate.showing} _START_ to _END_ of _TOTAL_ ${translate.entries}`,
                    "sInfoEmpty": `${translate.showing} 0 to 0 of 0 ${translate.entries}`
                },
                "bSort": false,
                "order": [[0, "desc"]],
                "columnDefs": [{
                    "targets": [],
                    "orderable": false,
                },
                // { className: 'text-center', targets: [3], "width": "20%" },
                { className: 'text-center', targets: [8] },
                ],
                "scrollX": false,
                "searching": true,
                "processing": true,
                "serverSide": true,
                "autoWidth": false,
                "pageLength": 10,
                "bLengthChange": false,
                "ajax": {
                    url: host + "/agent/upcoming-game/get?parentGameId=" + parentGameId,
                    type: "GET",
                },
                "columns": [
                    { "data": "gameNumber" },
                    { "data": "gameName" },
                    { "data": "startTime" },
                    {
                        "data": "ticketColorPrice",
                        "render": function (data, type, row) {


                            var $select = $('<select class="selectColor" id="select1-' + row._id + '" ></select>', {
                                "id": row._id,
                                "value": data
                            });
                            $.each(data, function (k, v) {
                                var $option = $("<option></option>", {
                                    "text": v.color,
                                    "value": k
                                });
                                if (data === v) {
                                    $option.attr("selected", "selected")
                                }
                                $select.append($option);
                            });
                            return $select.prop("outerHTML");
                        }
                    }, {
                        "data": "ticketColorPrice",
                        "render": function (data, type, row) {
                            var $select = $('<select class="selectPrice" id="select2-' + row._id + '" ></select>', {
                                "id": row._id,
                                "value": data
                            });
                            $.each(data, function (k, v) {
                                var $option = $("<option></option>", {
                                    "text": v.price,
                                    "value": k
                                });
                                if (data == v) {
                                    $option.attr("selected", "selected")
                                }
                                $select.append($option);
                            });
                            return $select.prop("outerHTML");
                        }
                    },
                    { "data": "totalTicketsSold", },
                    { "data": "earnedFromTickets" },
                    {
                        "data": "status",
                        render: function (data, type, row) {
                            if (row.status == "active" && row.isStopped == false) {
                                return "Upcoming"
                            } else if (row.status == "active" && row.isStopped == true) {
                                return "Stopped"
                            }
                            return row.status;
                        }
                    },
                    // {
                    //     "data": "action",
                    //     render: function (data, type, row) {
                    //         let html = "";
                    //         if(row.isStopped == false && row.isMaster == true){
                    //             html += `<a class="btn btn-info btn-xs btn-rounded stopUpcomingGame" id="` + row._id + `"> Stop </a>`;
                    //         }
                    //         return html;
                    //     }
                    // }
                    {
                        "data": "action",
                        render: function (data, type, row) {
                            let html = "";
                            if (row.isStopped === false && row.isMaster === true) {
                                html += `<a class="btn btn-info btn-xs btn-rounded stopUpcomingGame" id="` + row._id + `"> ${translate.stop} </a>`;
                            } else if (row.isStopped === true) {
                                // Disable resume button dynamically if game is not eligible
                                let disabled = row.nextGameStarted ? 'disabled' : '';
                                html += `<a class="btn btn-success btn-xs btn-rounded resumeUpcomingGame" id="` + row._id + `" ${disabled}> ${translate.resume} </a>`;
                            }
                            return html;
                        }
                    }
                ],
                "rowCallback": function (row, data) {

                    let color = $(row).find('#select1-' + data._id + '');
                    color.on("change", function () {
                        let id = $(this).val();
                        $('#select2-' + data._id + '').val(id);
                    });

                    let price = $(row).find('#select2-' + data._id + '');
                    price.on("change", function () {
                        let id = $(this).val();
                        $('#select1-' + data._id + '').val(id);
                    });

                },
                createdRow: function (row, data, dataIndex) {
                    // mark testing games
                    if (data.isTestGame) {
                      $(row).css('background-color', '#e3f2fd'); // inline style wins
                    }
                }
            });
        } else {
            console.log("upcomingGamesTable called else")
            //$('#upcomingGamesTable').DataTable().ajax.reload();
            $('#upcomingGamesTable').DataTable().ajax.url(host + "/agent/upcoming-game/get?parentGameId=" + parentGameId).load();
        }
        $('#upcomingGamesModal').modal('show');
    }



    $('body').on('click', '.stopUpcomingGame', async function (e) {
        e.preventDefault();
        const gameId = e.target.id;
        swal({
            title: `${translate.alert}!`,
            text: `${translate.sure_want_to_stop_game}?`,
            type: "warning",
            showCancelButton: true,
            confirmButtonColor: "#e69a2a",
            confirmButtonText: `${translate.stop}`,
            cancelButtonText: `${translate.cancel}`,
            // closeOnConfirm: false,
            // closeOnCancel: false,
            html: true
        }, async function (isConfirm) {
            if (isConfirm) {
                console.log("stop the game")
                $.ajax({
                    type: 'POST',
                    url: host + "/agent/upcoming-game/stop",
                    data: {
                        id: gameId,
                    },
                    success: function (resultData) {
                        console.log(resultData);
                        if (resultData.status == 'success') {
                            $('#upcomingGamesTable').DataTable().ajax.reload();
                        } else {
                            $('#upcomingGamesTable').DataTable().ajax.reload();
                            swal("Failed!", resultData.message, "error");
                        }
                    }
                });
            }
        });
    });


    $('body').on('click', '.resumeUpcomingGame', async function (e) {
        e.preventDefault();
        const gameId = e.target.id;
        // First, check if the game is eligible for restoration
        $.ajax({
            type: 'GET',
            url: host + "/agent/upcoming-game/check-resume-eligibility",
            data: { id: gameId },
            success: function (response) {
                if (response.eligible) {
                    swal({
                        title: `${translate.alert}!`,
                        text: `${translate.sure_resume_game}?`,
                        type: "warning",
                        showCancelButton: true,
                        confirmButtonColor: "#28a745",
                        confirmButtonText: `${translate.resume}`,
                        cancelButtonText: `${translate.cancel}`,
                        closeOnCancel: true
                    }, async function (isConfirm) {
                        if (isConfirm) {
                            $.ajax({
                                type: 'POST',
                                url: host + "/agent/upcoming-game/resume",
                                data: { id: gameId },
                                success: function (resultData) {
                                    if (resultData.status == 'success') {
                                        $('#upcomingGamesTable').DataTable().ajax.reload();
                                    } else {
                                        swal("Failed!", resultData.message, "error");
                                    }
                                }
                            });
                        }
                    });
                } else {
                    swal("Error!", response.message, "error");
                }
            }
        });
    });


    let scrollPosition = 0;
    // Global handler for all modals
    $(document).on('show.bs.modal', function () {
        // Save the current scroll position
        scrollPosition = $(window).scrollTop();

        // Apply fixed positioning to prevent page jump
        $('body').css({
            overflow: 'hidden',
            position: 'fixed',
            top: -scrollPosition + 'px',
            width: '100%'
        });
    });

    $(document).on('hidden.bs.modal', function () {
        // Restore the body's default styles
        $('body').css({
            overflow: '',
            position: '',
            top: '',
            width: ''
        });

        // Restore the scroll position
        $(window).scrollTop(scrollPosition);
    });
    
    // dont open modal if it is already open
    function showModalIfNotOpen($modal) {
        if (!$modal.hasClass("in")) {
            $modal.modal("show");
        }
    }

    // Open the Slot Machine Details Modal and Set Title Dynamically
    $('.slot-option').on('click', function () {
        const option = $(this).data('option');
        if (option === "Metronia" || option === "OK Bingo") {
            $('#slotMachineDetailsModal .modal-title').text(option); // Set the modal title dynamically
            $('#slotMachineDetailsModal').modal('show'); // Show the modal
        }
    });

    // Add validation when the "Add" button is clicked
    // $(".custom-btn").on("click", function (e) {
    //     const clickedButton = $(this).attr("id");
    //     if (clickedButton === "balance_on_ticket" || clickedButton === "close_ticket") {
    //         // Add validation
    //         $("#machine_ticketId").attr("data-validation", "required");
    //     } else if(clickedButton === "pay_by_cash_machine" || clickedButton === "pay_by_card_machine" || clickedButton === "pay_by_player_account_machine"){
    //         $("#machine_amount").attr("data-validation", "required");
    //         if(clickedButton === "pay_by_player_account_machine"){
    //             // Get the existing data-validation value
    //             const usernameField = $("#machine_username");
    //             const currentValidation = usernameField.attr("data-validation") || "";
    //             // Define the new validation to add
    //             const newValidation = "required";
    //             // Check if the new validation already exists; if not, append it
    //             if (!currentValidation.includes(newValidation)) {
    //                 usernameField.attr("data-validation", currentValidation + " " + newValidation);
    //             }
    //        }
    //     }
    // });

    // // reset validation of machine form
    // function resetMachineFormValidation(){
    //     $("#machine_username").removeAttr("data-validation");
    //     $("#machine_amount").removeAttr("data-validation");
    //     $("#machine_ticketId").removeAttr("data-validation");
    //     $.validate(); // This reinitializes validation for the whole form
    //     if (!$("#slotMachineForm").isValid()) {
    //         isValid = false;
    //         if ($(".has-error").length) {
    //             let el = $('.has-error').first();
    //             if (! $.isEmptyObject(el)) {
    //                 $('html, body').animate({
    //                     scrollTop: (el.offset().top)
    //                 },10);
    //             }
    //         }
    //     }
    // }

    // // reset selected buttons
    // function resetMachineSelectButtons(){
    //     // List of IDs to remove the 'selectedClass' from
    //     const idsToRemoveClass = ['#make_ticket', '#add_to_ticket'];

    //     // Loop through each ID and remove the 'selectedClass' if it exists
    //     idsToRemoveClass.forEach(function(id) {
    //         if ($(id).hasClass('selected')) {
    //             $(id).removeClass('selected');
    //         }
    //     });
    // }

    // let selectedActionMachine = null; // Track the selected action

    // // Highlight "Make Ticket" or "Add to Ticket" and store the action
    // $(".custom-btn").on("click", function (e) {
    //     e.preventDefault(); // Prevent default form submission
    //     // Only apply the selected class to make_ticket and add_to_ticket buttons
    //     if ($(this).is("#make_ticket, #add_to_ticket")) {
    //         // Toggle the 'selected' class to simulate radio button behavior
    //         if ($(this).hasClass("selected")) {
    //             $(this).removeClass("selected"); // Deselect the button if already selected
    //             selectedActionMachine = null; // Reset selectedActionMachine when deselected
    //         } else {
    //             $(".custom-btn").removeClass("selected"); // Deselect any other button
    //             $(this).addClass("selected"); // Select the clicked button

    //             // Store the selected action in a variable
    //             const clickedButton = $(this).attr("id");

    //             if (clickedButton === "make_ticket") {
    //                 selectedActionMachine = "make_ticket";
    //             } else if (clickedButton === "add_to_ticket") {
    //                 selectedActionMachine = "add_to_ticket";
    //             }
    //         }
    //     }
    // });

    // // Handle payment method selection and final validation
    // $(".pay-method").on("click", function (e) {
    //     e.preventDefault(); // Prevent default form submission

    //     resetMachineFormValidation() //  reset all validations
    //     // Ensure an action is selected
    //     if (!selectedActionMachine) {
    //         alert("Please select 'Make Ticket' or 'Add to Ticket' first.");
    //         return;
    //     }

    //     // Validate required fields based on the selected action
    //     let isValid = true;
    //     if (selectedActionMachine === "make_ticket" || selectedActionMachine === "add_to_ticket") {
    //         $("#machine_amount").attr("data-validation", "required");

    //         const clickedButton = $(this).attr("id");
    //         if(clickedButton === "pay_by_player_account_machine"){
    //             // Get the existing data-validation value
    //             const usernameField = $("#machine_username");
    //             const currentValidation = usernameField.attr("data-validation") || "";
    //             // Define the new validation to add
    //             const newValidation = "required";
    //             // Check if the new validation already exists; if not, append it
    //             if (!currentValidation.includes(newValidation)) {
    //                 usernameField.attr("data-validation", currentValidation + " " + newValidation);
    //             }
    //         }

    //         // Re-trigger the validation to apply the newly added required validation
    //         $.validate(); // This reinitializes validation for the whole form

    //         if (!$("#slotMachineForm").isValid()) {
    //             isValid = false;
    //             if ($(".has-error").length) {
    //                 let el = $('.has-error').first();
    //                 if (! $.isEmptyObject(el)) {
    //                     $('html, body').animate({
    //                         scrollTop: (el.offset().top)
    //                     },10);
    //                 }
    //             }
    //         }
    //     }

    //     // If validations pass, trigger the AJAX call
    //     if (isValid) {
    //         const selectedPaymentMethod = $(this).attr("id");
    //         console.log("call ajax")
    //         //triggerAjax(selectedActionMachine, selectedPaymentMethod);
    //     }
    // });

    // // Handle direct actions for "Saldo on Ticket" and "Close Ticket"
    // $(".direct-action").on("click", function (e) {
    //     e.preventDefault(); // Prevent default form submission
    //     resetMachineSelectButtons();
    //     resetMachineFormValidation() //  reset all validations
    //     const clickedButton = $(this).attr("id");

    //     if (clickedButton === "balance_on_ticket" || clickedButton === "close_ticket") {
    //         // Add validation
    //         $("#machine_ticketId").attr("data-validation", "required");
    //     }

    //     // Re-trigger the validation to apply the newly added required validation
    //     $.validate(); // This reinitializes validation for the whole form


    //     console.log("slot validation--", $("#slotMachineForm").isValid())
    //     if (!$("#slotMachineForm").isValid()) {
    //         if ($(".has-error").length) {
    //             let el = $('.has-error').first();
    //             if (! $.isEmptyObject(el)) {
    //                 $('html, body').animate({
    //                     scrollTop: (el.offset().top)
    //                 },10);
    //             }
    //         }
    //     } else {
    //         // Trigger AJAX call directly
    //         triggerAjax(clickedButton);
    //     }

    // });

    // // AJAX Trigger Function
    // function triggerAjax(action, paymentMethod = null) {
    //     console.log("trigger called")
    //     const data = {
    //         username: $("#machine_username").val(),
    //         amount: $("#machine_amount").val(),
    //         ticketId: $("#machine_ticketId").val(),
    //         action: action,
    //         paymentMethod: paymentMethod,
    //     };

    //     // Example AJAX call
    //     $.ajax({
    //         url: "/your-api-endpoint",
    //         method: "POST",
    //         data: data,
    //         success: function (response) {
    //             console.log(`Action: ${action}, Payment: ${paymentMethod}`, response);
    //             alert("Action successfully completed.");
    //             // Reset UI after successful completion
    //             $(".custom-btn").removeClass("btn-selected");
    //             selectedAction = null;
    //         },
    //         error: function (xhr) {
    //             console.error(xhr);
    //             alert("An error occurred. Please try again.");
    //         },
    //     });
    // }


    // Function to reset form validation
    // function resetMachineFormValidation() {
    //     // Remove validation from fields
    //     $("#machine_username, #machine_amount, #machine_ticketId").removeAttr("data-validation");
    //     $("#machine_username").attr("data-validation", "username_server");
    //     $.validate(); // Reinitialize validation for the whole form

    //     // Handle invalid form
    //     if (!$("#slotMachineForm").isValid()) {
    //         let firstError = $('.has-error').first();
    //         if (firstError.length) {
    //             $('html, body').animate({
    //                 scrollTop: firstError.offset().top
    //             }, 10);
    //         }
    //     }
    // }

    // // Function to reset selected buttons
    // function resetMachineSelectButtons() {
    //     // List of IDs to remove the 'selectedClass' from
    //     const idsToRemoveClass = ['#make_ticket', '#add_to_ticket'];

    //     idsToRemoveClass.forEach(id => {
    //         $(id).removeClass('selected');
    //     });
    // }

    // let selectedActionMachine = null; // Track the selected action

    // // Handle the selection of "Make Ticket" or "Add to Ticket"
    // $(".custom-btn").on("click", function (e) {
    //     e.preventDefault();
    //     resetMachineFormValidation();
    //     $(".custom-btn").removeClass("selected");
    //     const buttonId = $(this).attr("id");

    //     if (buttonId === "make_ticket" || buttonId === "add_to_ticket") {
    //         $(this).toggleClass("selected"); // Toggle 'selected' class
    //         selectedActionMachine = $(this).hasClass("selected") ? buttonId : null;
    //     }
    // });

    // // Handle payment method selection
    // $(".pay-method").on("click", function (e) {
    //     e.preventDefault();
    //     resetMachineFormValidation();

    //     if (!selectedActionMachine) {
    //         alert("Please select 'Make Ticket' or 'Add to Ticket' first.");
    //         return;
    //     }

    //     // Add validation rules based on the action
    //     $("#machine_amount").attr("data-validation", "required");

    //     if ($(this).attr("id") === "pay_by_player_account_machine") {
    //         // Add validation to username if "pay_by_player_account_machine" is selected
    //         const usernameField = $("#machine_username");
    //         const currentValidation = usernameField.attr("data-validation") || "";
    //         // Define the new validation to add
    //         const newValidation = "required";
    //         // Check if the new validation already exists; if not, append it
    //         if (!currentValidation.includes(newValidation)) {
    //             usernameField.attr("data-validation", currentValidation + " " + newValidation);
    //         }


    //     }

    //     $.validate(); // Reinitialize validation

    //     if ($("#slotMachineForm").isValid()) {
    //         const paymentMethod = $(this).attr("id");
    //         triggerAjax(selectedActionMachine, paymentMethod);
    //     } else {
    //         let firstError = $('.has-error').first();
    //         if (firstError.length) {
    //             $('html, body').animate({
    //                 scrollTop: firstError.offset().top
    //             }, 10);
    //         }
    //     }
    // });

    // // Handle direct actions like "Balance on Ticket" and "Close Ticket"
    // $(".direct-action").on("click", function (e) {
    //     e.preventDefault();
    //     resetMachineSelectButtons();
    //     resetMachineFormValidation();

    //     const clickedButton = $(this).attr("id");
    //     if (clickedButton === "balance_on_ticket" || clickedButton === "close_ticket") {
    //         $("#machine_ticketId").attr("data-validation", "required");
    //     }

    //     $.validate(); // Reinitialize validation

    //     if ($("#slotMachineForm").isValid()) {
    //         triggerAjax(clickedButton);
    //     } else {
    //         let firstError = $('.has-error').first();
    //         if (firstError.length) {
    //             $('html, body').animate({
    //                 scrollTop: firstError.offset().top
    //             }, 10);
    //         }
    //     }
    // });

    // // AJAX function for handling form submission
    // function triggerAjax(action, paymentMethod = null) {
    //     const data = {
    //         username: $("#machine_username").val(),
    //         amount: $("#machine_amount").val(),
    //         ticketId: $("#machine_ticketId").val(),
    //         action: action,
    //         paymentMethod: paymentMethod,
    //     };

    //     $.ajax({
    //         url: "/your-api-endpoint",
    //         method: "POST",
    //         data: data,
    //         success: function (response) {
    //             console.log(`Action: ${action}, Payment: ${paymentMethod}`, response);
    //             alert("Action successfully completed.");
    //             $(".custom-btn").removeClass("selected");
    //             selectedActionMachine = null; // Reset action after success
    //         },
    //         error: function (xhr) {
    //             console.error(xhr);
    //             alert("An error occurred. Please try again.");
    //         },
    //     });
    // }


    // Machine API 
    let selectedActionMachine = null; // Track the selected action
    // Helper function to scroll to the first error
    function scrollToFirstError() {
        const firstError = $('.has-error').first();
        if (firstError.length) {
            $('html, body').animate({ scrollTop: firstError.offset().top }, 10);
        }
    }

    // Reset form validation rules
    function resetMachineFormValidation() {
        $("#machine_username, #machine_amount, #machine_ticketId").removeAttr("data-validation")
        // Add validation rule to "machine_username" only if it has a value
        const usernameField = $("#machine_username");
        if (usernameField.val().trim() !== "") {
            usernameField.attr("data-validation", "username_server");
        }
        $.validate();

        if (!$("#slotMachineForm").isValid()) scrollToFirstError();
    }

    // Reset selected buttons
    function resetMachineSelectButtons() {
        ['#make_ticket', '#add_to_ticket'].forEach(id => $(id).removeClass('selected'));
    }

    function toggleDisablilityofButtons(button_type, status) {
        if (button_type == "pay_buttons") {
            $("#pay_by_cash_machine").attr("disabled", status);
            $("#pay_by_card_machine").attr("disabled", status);
            $("#pay_by_player_account_machine").attr("disabled", status);
        } else if (button_type == "balance_on_ticket") {
            $("#balance_on_ticket").attr("disabled", status);
        } else if (button_type == "close_ticket") {
            $("#close_ticket").attr("disabled", status);
        } else if (button_type == "close_all_tickets") {
            $("#close_all_tickets").attr("disabled", status);
        } else if (button_type == "all_buttons") {
            $("#pay_by_cash_machine").attr("disabled", status);
            $("#pay_by_card_machine").attr("disabled", status);
            $("#pay_by_player_account_machine").attr("disabled", status);
            $("#balance_on_ticket").attr("disabled", status);
            $("#close_ticket").attr("disabled", status);
            $("#close_all_tickets").attr("disabled", status);
        }
    }

    // Reset field validation state (removes error/valid classes and error messages)
    function resetFieldState(field) {
        field.removeClass('error valid');
        field.closest('.form-group').removeClass('has-error has-success');
        field.removeAttr('style');
        field.next('.form-error').remove(); // Remove any existing error messages
    }

    // Add event listener for dynamic validation
    $("#machine_username").on("input", function () {
        const usernameField = $(this);

        // Add validation rule if the field is not empty
        if (usernameField.val().trim() !== "") {
            addValidationRule("#machine_username", "username_server");
        } else {
            // Remove validation rule if the field is empty
            removeValidationRule("#machine_username", "username_server");
        }

        $.validate(); // Reinitialize validation
    });

    // Handle button selection for "Make Ticket" or "Add to Ticket"
    $(".custom-btn").on("click", function (e) {
        e.preventDefault();
        resetMachineFormValidation();

        const buttonId = $(this).attr("id");
        if (buttonId === "make_ticket" || buttonId === "add_to_ticket") {
            $(".custom-btn").removeClass("selected");
            $(this).toggleClass("selected");
            selectedActionMachine = $(this).hasClass("selected") ? buttonId : null;
        }
    });

    // Add or update validation rules
    function addValidationRule(selector, rule) {
        const field = $(selector);
        const currentValidation = field.attr("data-validation") || "";
        if (!currentValidation.includes(rule)) {
            field.attr("data-validation", `${currentValidation} ${rule}`.trim());
        }
    }

    // Remove specific validation rule
    function removeValidationRule(selector, rule) {
        const field = $(selector);
        const currentValidation = field.attr("data-validation") || "";
        const updatedValidation = currentValidation
            .split(" ")
            .filter(r => r !== rule)
            .join(" ")
            .trim();

        if (updatedValidation) {
            field.attr("data-validation", updatedValidation);
        } else {
            field.removeAttr("data-validation"); // Remove the attribute if no rules are left
            resetFieldState(field);
        }
    }

    // Handle payment method selection
    $(".pay-method").on("click", function (e) {
        e.preventDefault();
        resetMachineFormValidation();

        if (!selectedActionMachine) {
            alert(`${translate.select_make_or_add_ticket}`);
            return;
        }

        addValidationRule("#machine_amount", "number required");

        if (selectedActionMachine === "add_to_ticket") {
            addValidationRule("#machine_ticketId", "required");
        }

        if (selectedActionMachine === "make_ticket" || selectedActionMachine === "add_to_ticket") {
            //if ($(this).attr("id") === "pay_by_player_account_machine") {
            addValidationRule("#machine_username", "required");
        }

        $.validate();

        if ($("#slotMachineForm").isValid()) {
            const paymentMethod = $(this).val();
            triggerAjax(selectedActionMachine, paymentMethod);
        } else {
            scrollToFirstError();
        }
    });

    // Handle direct actions like "Balance on Ticket" and "Close Ticket"
    $(".direct-action").on("click", function (e) {
        e.preventDefault();
        resetMachineSelectButtons();
        resetMachineFormValidation();

        const clickedButton = $(this).attr("id");
        if (clickedButton === "balance_on_ticket" || clickedButton === "close_ticket") {
            addValidationRule("#machine_ticketId", "required");
        }

        $.validate();

        if ($("#slotMachineForm").isValid()) {
            triggerAjax(clickedButton);
        } else {
            scrollToFirstError();
        }
    });

    // AJAX function for handling form submission
    function triggerAjax(action, paymentMethod = null) {
        let machineName = $('#slotMachineDetailsModal .modal-title').text();
        const data = {
            username: $("#machine_username").val(),
            playerId: $("#playerIdOfUsernameMachine").val(),
            amount: $("#machine_amount").val(),
            ticketNumber: $("#machine_ticketId").val(),
            action: action,
            machineName: machineName,
            paymentMethod: paymentMethod,
        };

        // let ajaxUrl = "";
        // if (machineName) {
        //     machineName = machineName.replace(/\s+/g, '').toLowerCase(); // Removes all spaces
        // }
        // if(action == "make_ticket"){
        //     //ajaxUrl = `/agent/${machineName}/create-ticket`;
        //     ajaxUrl = `/agent/create-ticket`;
        //     toggleDisablilityofButtons("pay_buttons", true)  
        // }else if(action == "add_to_ticket"){
        //     //ajaxUrl = `/agent/${machineName}/add-balance`;
        //     ajaxUrl = `/agent/add-balance`;
        //     toggleDisablilityofButtons("pay_buttons", true)
        // }else if(action == "balance_on_ticket"){
        //     //ajaxUrl = `/agent/${machineName}/get-balance`;
        //     ajaxUrl = `/agent/get-balance`;
        //     toggleDisablilityofButtons("balance_on_ticket", true)
        // }else if(action == "close_ticket"){
        //     //ajaxUrl = `/agent/${machineName}/close-ticket`;
        //     ajaxUrl = `/agent/close-ticket`;
        //     toggleDisablilityofButtons("close_ticket", true)
        // }else if(action == "close_all_tickets"){
        //     //ajaxUrl = `/agent/${machineName}/close-all-tickets`;
        //     ajaxUrl = `/agent/close-all-tickets`;
        //     toggleDisablilityofButtons("close_all_tickets", true)
        // }else if(action == "get_numbers_today_this_far"){
        //     //ajaxUrl = `/agent/${machineName}/get-numbers-today`;
        //     ajaxUrl = `/agent/get-numbers-today`;
        //     toggleDisablilityofButtons("get_numbers_today_this_far", true)
        // }

        const ajaxUrl = getAjaxUrl(action, machineName);

        if (!ajaxUrl) return;

        toggleDisablilityofButtons(getButtonGroup(action), true);

        $.ajax({
            url: ajaxUrl,
            method: "POST",
            data: data,
            success: function (response) {
                toggleDisablilityofButtons(getButtonGroup(), false); //toggleDisablilityofButtons("all_buttons", false);
                $(".custom-btn").removeClass("selected");

                selectedActionMachine = null; // Reset action after success
                const messageContainer = response?.status === "success" ? '#machineSuccessContainer' : '#machineErrorContainer';
                const message = response.message;
                if (action !== "get_numbers_today_this_far" || (response?.status === "fail")) {
                    $(messageContainer).html(message).removeClass('hidden');
                }
                setTimeout(() => {
                    $(messageContainer).addClass('hidden');
                }, 3000);
                if (response.status === "success") {
                    if (action == "make_ticket" || action == "add_to_ticket") {
                        if (response?.result?.paymentType.toLowerCase() === "cash") {
                            $("#rootChips").text(parseFloat(response.result.dailyBalance).toFixed(2));
                        }
                        // update current balance
                        $('.financialUserName').keyup();
                    }

                    // if(action == "add_to_ticket" || action == "balance_on_ticket"){
                    //     swal({
                    //         title: `${translate.ticket_info}: ${$("#machine_ticketId").val()}`,  // Dynamic ticket number in title
                    //         html: true,
                    //         text: `
                    //         <div class="custom-swal-content">
                    //             <div><strong>${translate.balance}:</strong> ${response.result.balance}</div>
                    //             <div><strong>${translate.ticket_status}:</strong> ${response.result.ticketStatus ? 'Active' : 'Closed'}</div>
                    //         </div>
                    //         `,
                    //         icon: 'success',
                    //         confirmButtonText: 'Ok',
                    //     });
                    // }else if(action == "make_ticket" || action == "close_ticket"){
                    //     // Create printable content
                    //     const printableContent = `
                    //         <div id="print-area" style="display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; flex-direction: column;">
                    //             <h1 style="margin-bottom: 20px;">${translate.ticket_details}</h1>    
                    //             <div style="text-align: left; display: inline-block;">
                    //                 <p><strong>${translate.ticket_number}:</strong> ${response.result.ticketNumber}</p>
                    //                 <p><strong>${translate.balance}:</strong> ${response.result.balance}</p>
                    //                 <p><strong>${translate.ticket_status}:</strong> Active</p>
                    //             </div>
                    //         </div>
                    //     `;

                    //     // Add content to a hidden div
                    //     let printWindow = window.open('', '_blank', 'width=400,height=300');
                    //     printWindow.document.write(`
                    //         <html>
                    //         <head>
                    //             <title>${translate.print_details}</title>
                    //             <style>
                    //                 @page {
                    //                     size: 3in 3in; /* Page size set to 3x3 inches */
                    //                     margin: 0; /* No margins for the page */
                    //                 }
                    //                 @media print {
                    //                     body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
                    //                     #print-area {
                    //                         display: flex;
                    //                         justify-content: center;
                    //                         align-items: center;
                    //                         height: 100vh; /* Full viewport height for centering */
                    //                         text-align: center; 
                    //                         flex-direction: column;
                    //                     }
                    //                     h1 {
                    //                         font-size: 14pt; /* Slightly larger for headers */
                    //                         margin-bottom: 10px;
                    //                     }
                    //                     #print-area div {
                    //                         text-align: left; /* Align text to the left */
                    //                         display: inline-block; /* Keep content compact */
                    //                     }
                    //                     p {
                    //                         margin: 5px 0; /* Spacing between paragraphs */
                    //                         width: 200px; /* Fixed width for consistent alignment */
                    //                     }
                    //                 }
                    //             </style>
                    //         </head>
                    //         <body>
                    //             ${printableContent}
                    //         </body>
                    //         </html>
                    //     `);

                    //     // Print and close the window
                    //     printWindow.document.close();
                    //     printWindow.focus();
                    //     printWindow.print();
                    //     printWindow.close();
                    // }else if(action == "get_numbers_today_this_far"){
                    //     swal({
                    //         title: `${translate.todays_number_this_far}`, 
                    //         html: true,
                    //         text: `
                    //         <div class="custom-swal-content">
                    //             <div><strong>${translate.in_amount}:</strong> ${response.result.totalIn}</div>
                    //             <div><strong>${translate.out_amount}:</strong> ${response.result.totalOut}</div>
                    //         </div>
                    //         `,
                    //         icon: 'success',
                    //         confirmButtonText: 'Ok',
                    //     });
                    // }else if(action == "close_all_tickets"){
                    //     // Extract ticketNumbers with ticketStatus: false
                    //     let falseTicketNumbers = [];
                    //     if (response.tickets && response.tickets.length > 0) {
                    //         falseTicketNumbers = response.tickets
                    //             .filter(ticket => ticket.ticketStatus === false)
                    //             .map(ticket => ticket.ticketNumber);
                    //     }
                    //     console.log("Not closed ticket:", falseTicketNumbers); 

                    //     if(falseTicketNumbers.length > 0){
                    //         // Create a string representation of the ticket numbers
                    //         let ticketNumbersText = falseTicketNumbers.join(', ');
                    //         swal({
                    //             title: `${translate.operation_completed_but_tickets_are_open}:`,
                    //             text: `<div class="custom-swal-content"><strong>${translate.open_tickets}:</strong>  ${ticketNumbersText}</div>`,
                    //             icon: 'success',
                    //             confirmButtonText: 'Ok',
                    //             html: true, // Enable HTML rendering
                    //         });
                    //         setTimeout(() => {
                    //             const swalTitle = document.querySelector('.sweet-alert h2');
                    //             if (swalTitle) {
                    //                 swalTitle.style.fontSize = '16px'; // Example of inline styling
                    //                 swalTitle.style.fontWeight = 'bold';
                    //                 swalTitle.style.textAlign = 'center'; // Align title to the center
                    //                 swalTitle.style.lineHeight = '1.5';  // Set line-height
                    //             }
                    //         }, 100); // Use a slight delay to ensure swal has been fully rendered
                    //     }
                    // } else{
                    //     // if(response?.result?.paymentType.toLowerCase() === "cash"){
                    //     //     $("#rootChips").text(parseFloat(response.result.dailyBalance).toFixed(2));
                    //     // }

                    // }

                    switch (action) {
                        case "balance_on_ticket":
                        case "add_to_ticket":
                            showTicketInfo(response.result);
                            break;
                        case "make_ticket":
                            printTicket(response.result, true);
                            break;
                        case "close_ticket":
                            printTicket(response.result, false);
                            break;
                        case "get_numbers_today_this_far":
                            showNumbersToday(response.result);
                            break;
                        case "close_all_tickets":
                            handleOpenTickets(response.tickets);
                            break;
                    }
                    clearSlotMachineForm();
                } else {
                    // setTimeout(() => {
                    //     $(messageContainer).addClass('hidden');
                    // }, 4000);
                }
            },
            error: function (xhr) {
                toggleDisablilityofButtons(getButtonGroup(), false); //toggleDisablilityofButtons("all_buttons", false);
                const errorMessage = xhr.responseJSON?.message || xhr.responseText || "An unexpected error occurred";
                $("#machineErrorContainer").html(errorMessage).removeClass('hidden');
                setTimeout(() => {
                    $("#machineErrorContainer").addClass('hidden');
                }, 4000);
                clearSlotMachineForm();
            },
        });
    }
    // get ajax url for machines different operation
    function getAjaxUrl(action) {
        const actionUrls = {
            "make_ticket": "/agent/create-ticket",
            "add_to_ticket": "/agent/add-balance",
            "balance_on_ticket": "/agent/get-balance",
            "close_ticket": "/agent/close-ticket",
            "close_all_tickets": "/agent/close-all-tickets",
            "get_numbers_today_this_far": "/agent/get-numbers-today",
        };
        return actionUrls[action] || null;
    }
    // get id for different operation
    function getButtonGroup(action) {
        const buttonGroups = {
            "make_ticket": "pay_buttons",
            "add_to_ticket": "pay_buttons",
            "balance_on_ticket": "balance_on_ticket",
            "close_ticket": "close_ticket",
            "close_all_tickets": "close_all_tickets",
            "get_numbers_today_this_far": "get_numbers_today_this_far",
        };
        return buttonGroups[action] || "all_buttons";
    }
    // show ticket info of specific ticket
    function showTicketInfo(result) {
        swal({
            title: `${translate.ticket_info}: ${$("#machine_ticketId").val()}`,  // Dynamic ticket number in title
            html: true,
            text: `
            <div class="custom-swal-content">
                <div><strong>${translate.balance}:</strong> ${result.balance}</div>
                <div><strong>${translate.ticket_status}:</strong> ${result.ticketStatus ? 'Active' : 'Closed'}</div>
            </div>
            `,
            icon: 'success',
            confirmButtonText: 'Ok',
        });
    }
    // print ticket for create ticket and close ticket
    function printTicket(result, isActive) {
        const status = isActive ? 'Active' : 'Closed';
        const printableContent = `
            <div id="print-area" style="display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; flex-direction: column;">
                <h1 style="margin-bottom: 20px;">${translate.ticket_details}</h1>    
                <div style="text-align: left; display: inline-block;">
                    <p><strong>${translate.machine_name}:</strong> ${result.machineName}</p>
                    <p><strong>${translate.ticket_number}:</strong> ${result.ticketNumber}</p>
                    <p><strong>${translate.balance}:</strong> ${result.balance}</p>
                    <p><strong>${translate.ticket_status}:</strong>${status}</p>
                </div>
            </div>
        `;
        const printWindow = window.open('', '_blank', 'width=400,height=300');
        printWindow.document.write(`
            <html>
            <head>
                <title>${translate.print_details}</title>
                 <style>
                    @page {
                        size: 3in 3in; /* Page size set to 3x3 inches */
                        margin: 0; /* No margins for the page */
                    }
                    @media print {
                        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
                        #print-area {
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh; /* Full viewport height for centering */
                            text-align: center; 
                            flex-direction: column;
                        }
                        h1 {
                            font-size: 14pt; /* Slightly larger for headers */
                            margin-bottom: 10px;
                        }
                        #print-area div {
                            text-align: left; /* Align text to the left */
                            display: inline-block; /* Keep content compact */
                        }
                        p {
                            margin: 5px 0; /* Spacing between paragraphs */
                            width: 200px; /* Fixed width for consistent alignment */
                        }
                    }
                </style>
            </head>
            <body>${printableContent}</body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    }

    function showNumbersToday(result) {
        swal({
            title: `${translate.todays_number_this_far}`,
            html: true,
            text: `
            <div class="custom-swal-content">
                <div><strong>${translate.in_amount}:</strong> ${result.totalIn}</div>
                <div><strong>${translate.out_amount}:</strong> ${result.totalOut}</div>
            </div>
            `,
            icon: 'success',
            confirmButtonText: 'Ok',
        });
    }

    function handleOpenTickets(tickets) {
        // Extract ticketNumbers with ticketStatus: false
        const openTickets = tickets?.filter(ticket => !ticket.ticketStatus).map(ticket => ticket.ticketNumber) || [];
        if (openTickets.length) {
            swal({
                title: `${translate.operation_completed_but_tickets_are_open}:`,
                text: `<div class="custom-swal-content"><strong>${translate.open_tickets}:</strong> ${openTickets.join(', ')}</div>`,
                icon: 'success',
                confirmButtonText: 'Ok',
                html: true, // Enable HTML rendering
            });
            setTimeout(() => {
                const swalTitle = document.querySelector('.sweet-alert h2');
                if (swalTitle) {
                    swalTitle.style.fontSize = '16px';
                    swalTitle.style.fontWeight = 'bold';
                    swalTitle.style.textAlign = 'center'; // Align title to the center
                    swalTitle.style.lineHeight = '1.5';  // Set line-height
                }
            }, 100);
        }
    }

    function clearSlotMachineForm() {
        $("#slotMachineForm")[0].reset();
        $('#usernameBalanceResult').text('');
        $("#playerIdOfUsernameMachine").val('');
    }

    $('#slotMachineDetailsModal').on('hidden.bs.modal', function () {
        clearSlotMachineForm();
    });

    // Validation for jackpot game
    function updateJackpotValidation(jackpotPrizeValues) {
        ["yellow", "white", "purple"].forEach(color => {
            const field = $(`#jackpotPrize${color.charAt(0).toUpperCase() + color.slice(1)}Modal`);
            const value = jackpotPrizeValues[color]?.toString().trim(); // Normalize value
            const parentDiv = field.closest(".col-sm-3"); // Get parent column
    
            if (value && value !== "0") {
                field.attr({ required: true, min: 4000, max: 50000 });
                parentDiv.show(); // Ensure it's visible
            } else {
                field.removeAttr("required min max");
                parentDiv.remove(); // Completely remove from layout
            }
        });
    }

    // Wheel of fortune reward popup on broadcast form game if only physical player wins
    adminSocket.on('wofPopup', async function (data) {
        console.log("open WOF popup to enter prize amount", data, hallId);
        if(data.hallId == hallId){
            adminSocket.emit('getOngoingGame', { hallId: data.hallId }, handleOngoingGameResponse);
            $('#confirmWofPrizeModal')
            .data('game-id', data.gameId) // store gameId on the modal
            .modal('show');
        }
    });

    $('body').on('click', '.addWOFPrize', function (e) {
        const $this = $(this);
        const gameId = $this.data('gameid');
        const existingPrize =  $this.attr('data-wofprize'); // Changed from data() to attr() to prevent cache data fetching
        
        // Reset form and validation state
        const $form = $('#saveWofPrizes');
        $form[0].reset();
       
        $('#confirmWofPrizeModal')
            .data('game-id', gameId)
            .find('#agentWofPrize')
            .val(existingPrize || '')
            .end()
            .modal('show');
    });

    // Submit handler for the wheel of fortune reward
    $('#saveWofPrizes').on('submit', async function (e) {
        e.preventDefault();
        
        const $form = $(this);
        const $modal = $('#confirmWofPrizeModal');
        const $errorAlert = $(".alertWofError");
        const $successAlert = $(".alertWofSuccess");
        const amount = $('#agentWofPrize').val();
        const gameId = $modal.data('game-id');

        // Validation
        if (!amount || !gameId) {
            showAlert($errorAlert, "wof-error", "Missing prize amount or game ID");
            return;
        }

        try {
            const response = await $.ajax({
                url: '/agent/wof/reward',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ amount, gameId })
            });

            if (response.status === "success") {
                // Update UI
                $(`.addWOFPrize[data-gameid="${gameId}"]`).attr('data-wofprize', amount);
                showAlert($successAlert, "wof-success", response.message);
                
                // Close modal after success
                setTimeout(() => {
                    $modal.modal('hide');
                    $form[0].reset(); // Reset form
                }, 2000);
            } else {
                showAlert($errorAlert, "wof-error", response.message || "Failed to save prize");
            }
        } catch (error) {
            console.error('Error saving WOF prize:', error);
            showAlert($errorAlert, "wof-error", "Server error. Please try again later.");
        }
    });

    // Helper function for showing alerts
    function showAlert($alert, type, message) {
        $alert.find(`.alert-${type}-text`).html(message);
        $alert.show().delay(2000).fadeOut();
    }

    // Stop Game functionality
    $("#stopGame").on('click', function(e) {
        e.preventDefault();
        let myGroupHalls = JSON.parse($(this).attr('data-mygrouphalls'));
        // Get Group of halls of requesting
        $.ajax({
            type: 'GET',
            url: host + "/agent/game/get-my-group-halls",
            success: function (resultData) {
                console.log("resultData of my group halls", resultData)
                if (resultData.status == "success") {
                    myGroupHalls = resultData.halls;
                } 
            },
            error: function (d, s, e) {
                console.log("error occured", s, e);
            }
        });
        $('#stopGameModal').modal('show');
        if(myGroupHalls){
            const dropdown = $('#hallSelectionDropdown');
            dropdown.empty();
            myGroupHalls.forEach(function(hall) {
                dropdown.append(`<option value="${hall.id}">${hall.name}</option>`);
            });
        }
    });

    // Handle stop game option button clicks
    $('body').on('click', '.stopGameOption', function(e) {
        e.preventDefault();
        const option = $(this).data('option');
        const button = $(this);
        
        // Disable all buttons to prevent multiple clicks
        $('.stopGameOption').prop('disabled', true);
        
        let confirmMessage = '';
        let ajaxData = { gameId: $("#isAgentReadyOngoing").attr("data-ongoinggameid") || $("#ongoingGameContainer").attr("data-ongoinggameid") || $("#resumeGame").attr("data-ongoingGameId") };
        //let ajaxData = { gameId: "685a605081558e45f7608b59", action: 'stop_game_hall', refundHallId: "66d685876a0b63bbbd8b75aa" };
        switch(option) {
            case 'stop_game_without_refund':
                confirmMessage = `${translate.are_you_sure_you_want_to_stop_game_without_refund}?`;
                ajaxData.action = 'stop_game_without_refund';
                break;
                
            case 'stop_game_and_refund':
                confirmMessage = `${translate.are_you_sure_you_want_to_stop_game_and_refund_all_halls}?`;
                ajaxData.action = 'stop_game_and_refund';
                break;
                
            case 'stop_game_hall':
                const selectedHall = $('#hallSelectionDropdown').val();
                if (!selectedHall) {
                    swal(`${translate.error}`, `${translate.please_select_a_hall}`, "error");
                    $('.stopGameOption').prop('disabled', false);
                    return;
                }
                const hallName = $('#hallSelectionDropdown option:selected').text();
                confirmMessage = `${translate.are_you_sure_you_want_to_stop_game_in_hall}: ${hallName}?`;
                Object.assign(ajaxData, { action: 'stop_game_hall', refundHallId: selectedHall });
                break;
        }
        
        // Show confirmation dialog
        swal({
            title: `${translate.are_you_sure}?`,
            text: confirmMessage,
            type: "warning",
            showCancelButton: true,
            confirmButtonColor: "#e69a2a",
            confirmButtonText: `${translate.yes}`,
            cancelButtonText: `${translate.no}`,
            closeOnConfirm: false,
            closeOnCancel: true     
        }, function(isConfirm) {
            if (isConfirm) {
                // Show loading state
                //button.html('<i class="fa fa-spinner fa-spin"></i> ' + translate.processing);
                
                // Make AJAX call
                $.ajax({
                    type: 'POST',
                    url: host + "/agent/game/stop-option",
                    data: ajaxData,
                    success: function(resultData) {
                        console.log("Stop game response:", resultData);
                        
                        if (resultData.status === 'success') {
                            swal(`${translate.success}`, resultData.message || `${translate.game_stopped_successfully}`, "success");
                            // Close the modal
                            $('#stopGameModal').modal('hide');
                        } else {
                            swal(`${translate.failed}`, resultData.message || `${translate.failed_to_stop_game}`, "error");
                        }
                    },
                    error: function(xhr, status, error) {
                        console.error("Error stopping game:", error);
                        swal(`${translate.error}`, `${translate.something_went_wrong}`, "error");
                    },
                    complete: function() {
                        // Re-enable all buttons
                        $('.stopGameOption').prop('disabled', false);
                        // Reset button text
                        button.html(button.data('original-text') || button.text());
                    }
                });
            } else {
                // Re-enable all buttons if user cancels
                $('.stopGameOption').prop('disabled', false);
            }
        });
    });

})
