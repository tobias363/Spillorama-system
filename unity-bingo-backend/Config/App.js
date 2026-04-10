require('dotenv').config();
module.exports = {
    connectionType: 'local',
    details: {
        name: 'Spillorama Bingo',
        version: '2.3.0',
    },
    baseUrl: {
        localhostUrl: "http://localhost:8080/",
        developementUrl: "https://bingoadmin.aistechnolabs.in/"
    },
    maxPlayers: 9,
    logger: {
        logFolder: 'Log', // Change Your Name With Your Custom Folder
        logFilePrefix: 'bingo-game'
    },
    defaultUserLogin: {
        name: 'Bingo Game',
        email: process.env.DEFAULT_ADMIN_USER_LOGIN_EMAIL,
        password: process.env.DEFAULT_ADMIN_USER_LOGIN_PASSWORD,
        role: 'admin',
        avatar: 'user.png'
    },
    defaultCMS: {
        terms: {
            "title": "Terms & Condition",
            "description": "I'm Terms & Condition",
            "slug": "terms_and_condition",
        },
        support: {
            "title": "Support",
            "description": "I'm Support",
            "slug": "support",
        },
        aboutus: {
            "title": "About us",
            "description": "I'm About us",
            "slug": "about_us",
        },
        responsible_gameing: {
            "title": "Responsible - gameing",
            "description": "I'm Responsible - gameing",
            "slug": "responsible_gameing",
        },
        links: {
            "title": "Links of Other Agencies",
            "description": "I'm Links of Other Agencies ",
            "slug": "links",
        }
    },
    //Final SMTP
    mailer: {
        host: "smtp.gmail.com",
        port: 587,
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
        defaultFromAddress: 'Bingo Spillorama <bingospilorama@gmail.com>'
    },

    //Testing SMTP
    // mailer: {
    //     host: "smtp.office365.com",
    //     port: 25,
    //     auth: {
    //         user: "confirmation@switcht.com.au",
    //         pass: "Bundarie669%",
    //     },
    //     defaultFromAddress: 'Bingo Spilorama <bingospilorama@gmail.com>'
    // },

    local: {
        mode: 'local',
        payment: {
            registerurl: 'https://test.epayment.nets.eu/Netaxept/Register.aspx',
            processurl: 'https://test.epayment.nets.eu/Netaxept/Process.aspx',
            queryurl: 'https://test.epayment.nets.eu/Netaxept/Query.aspx',
            merchantId: '12003790',
            token: 'M?a4!8EcD_q52yJ(C7)s',
            CurrencyCode: 'EUR',
            redirectUrl: "http://localhost:8080/Payment"
        },
        verifonePayment: {
            currencyCode: 'NOK',
            entityId: process.env.VERIFONE_ENTITY_ID, //'b4d38695-26f3-4d36-9116-e2ab9eeea4f7',
            contractId: process.env.VERIFONE_CONTRACT_ID, //'68542720-804a-4bd4-9113-e08b50d7a44b',
            userId: process.env.VERIFONE_USER_ID,
            ApiId: process.env.VERIFONE_API_ID,
            sandboxCheckouUrl: 'https://emea.gsc.verifone.cloud/oidc/checkout-service/v2/checkout',
            redirectUrl: 'https://social-sincerely-tapir.ngrok-free.app/payment/deposit/response/',
            transactionUrl: 'https://emea.gsc.verifone.cloud/oidc/api/v2/transaction'
        },
        url: "https://social-sincerely-tapir.ngrok-free.app/", // "https://loving-brief-arachnid.ngrok-free.app/",
        metroniaApiURL: process.env.METRONIA_API_URL,
        metroniaApiToken: process.env.METRONIA_API_TOKEN_TEST,
        idkollan_url: process.env.IDKOLLEN_URL,
        idkollan_api_key:process.env.IDKOLLEN_API_KEY,
        idkollan_secret:process.env.IDKOLLEN_SECRET,
        idkollan_redirect_url: "https://bingoadmin.aistechnolabs.pro/player/bankid/redirect",
        sveve_username: process.env.SVEVE_USERNAME,
        sveve_password: process.env.SVEVE_PASSWORD,
        sveve_sender: process.env.SVEVE_SENDER
    },
    developement: {
        mode: 'developement',
        payment: {
            registerurl: 'https://test.epayment.nets.eu/Netaxept/Register.aspx',
            processurl: 'https://test.epayment.nets.eu/Netaxept/Process.aspx',
            queryurl: 'https://test.epayment.nets.eu/Netaxept/Query.aspx',
            merchantId: '12003790',
            token: 'M?a4!8EcD_q52yJ(C7)s',
            CurrencyCode: 'EUR',
            redirectUrl: "https://bingoadmin.aistechnolabs.in/Payment"
        },
        url: "https://bingoadmin.aistechnolabs.in/",
        metroniaApiURL: process.env.METRONIA_API_URL,
        metroniaApiToken: process.env.METRONIA_API_TOKEN_TEST,
        idkollan_url: process.env.IDKOLLEN_URL,
        idkollan_api_key:process.env.IDKOLLEN_API_KEY,
        idkollan_secret:process.env.IDKOLLEN_SECRET,
        idkollan_redirect_url: "https://bingoadmin.aistechnolabs.pro/player/bankid/redirect",
        sveve_username: process.env.SVEVE_USERNAME,
        sveve_password: process.env.SVEVE_PASSWORD,
        sveve_sender: process.env.SVEVE_SENDER
    },
    staging: {
        mode: 'staging',
        payment: {
            registerurl: 'https://test.epayment.nets.eu/Netaxept/Register.aspx',
            processurl: 'https://test.epayment.nets.eu/Netaxept/Process.aspx',
            queryurl: 'https://test.epayment.nets.eu/Netaxept/Query.aspx',
            merchantId: '12003790',
            token: 'M?a4!8EcD_q52yJ(C7)s',
            CurrencyCode: 'EUR',
            redirectUrl: "https://bingoadmin.aistechnolabs.pro/Payment"
        },
        verifonePayment: {
            currencyCode: 'NOK',
            entityId: process.env.VERIFONE_ENTITY_ID, //'b4d38695-26f3-4d36-9116-e2ab9eeea4f7',
            contractId: process.env.VERIFONE_CONTRACT_ID, //'68542720-804a-4bd4-9113-e08b50d7a44b',
            userId: process.env.VERIFONE_USER_ID,
            ApiId: process.env.VERIFONE_API_ID,
            sandboxCheckouUrl: 'https://emea.gsc.verifone.cloud/oidc/checkout-service/v2/checkout',
            redirectUrl: 'https://bingoadmin.aistechnolabs.pro/payment/deposit/response/',
            transactionUrl: 'https://emea.gsc.verifone.cloud/oidc/api/v2/transaction'
        },
        url: "https://bingoadmin.aistechnolabs.pro/",
        metroniaApiURL: process.env.METRONIA_API_URL,
        metroniaApiToken: process.env.METRONIA_API_TOKEN_TEST,
        idkollan_url: process.env.IDKOLLEN_URL,
        idkollan_api_key:process.env.IDKOLLEN_API_KEY,
        idkollan_secret:process.env.IDKOLLEN_SECRET,
        idkollan_redirect_url: "https://bingoadmin.aistechnolabs.pro/player/bankid/redirect",
        sveve_username: process.env.SVEVE_USERNAME,
        sveve_password: process.env.SVEVE_PASSWORD,
        sveve_sender: process.env.SVEVE_SENDER
    },
    production: {
        mode: 'production',
        // payment: {
        //     registerurl: 'https://epayment.nets.eu/Netaxept/Register.aspx',
        //     processurl: 'https://epayment.nets.eu/Netaxept/Process.aspx',
        //     queryurl: 'https://epayment.nets.eu/Netaxept/Query.aspx',
        //     merchantId: '12003790',
        //     token: 'M?a4!8EcD_q52yJ(C7)s',
        //     CurrencyCode: 'EUR',
        //     redirectUrl: ""
        // },
        payment: {
            registerurl: 'https://test.epayment.nets.eu/Netaxept/Register.aspx',
            processurl: 'https://test.epayment.nets.eu/Netaxept/Process.aspx',
            queryurl: 'https://test.epayment.nets.eu/Netaxept/Query.aspx',
            merchantId: '12003790',
            token: 'M?a4!8EcD_q52yJ(C7)s',
            CurrencyCode: 'EUR',
            redirectUrl: "https://spillorama.aistechnolabs.info/Payment"
        },
        verifonePayment: {
            currencyCode: 'NOK',
            entityId: process.env.VERIFONE_ENTITY_ID, //'b4d38695-26f3-4d36-9116-e2ab9eeea4f7',
            contractId: process.env.VERIFONE_CONTRACT_ID, //'68542720-804a-4bd4-9113-e08b50d7a44b',
            userId: process.env.VERIFONE_USER_ID,
            ApiId: process.env.VERIFONE_API_ID,
            sandboxCheckouUrl: 'https://emea.gsc.verifone.cloud/oidc/checkout-service/v2/checkout',
            redirectUrl: 'https://spillorama.aistechnolabs.info/payment/deposit/response/',
            transactionUrl: 'https://emea.gsc.verifone.cloud/oidc/api/v2/transaction'
        },
        url: "https://spillorama.aistechnolabs.info/",
        metroniaApiURL: process.env.METRONIA_API_URL,
        metroniaApiToken: process.env.METRONIA_API_TOKEN_TEST,
        idkollan_url: process.env.IDKOLLEN_URL,
        idkollan_api_key:process.env.IDKOLLEN_API_KEY,
        idkollan_secret:process.env.IDKOLLEN_SECRET,
        idkollan_redirect_url: "https://spillorama.aistechnolabs.info/player/bankid/redirect",
        sveve_username: process.env.SVEVE_USERNAME,
        sveve_password: process.env.SVEVE_PASSWORD,
        sveve_sender: process.env.SVEVE_SENDER
    },
}