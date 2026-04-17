const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const PlayerSchema = new Schema({
    device_id: {
        type: 'string'
    },
    platform_os: {
        type: 'string'
    },
    name: {
        type: 'string'
    },
    username: {
        type: 'string',
        required: true
    },
    nickname: {         // Client change: nickname to Firstname
        type: 'string',
        required: false
    },
    dob: {
        type: Date,
        default: ''
    },
    enableNotification: {
        type: 'boolean',
        default: true
    },
    blockedTime: {
        type: Date
    },
    hall: {
        type: 'object',
        default: {}
    },
    groupHall: {
        type: 'object',
        default: {}
    },
    hallId: {
        type: 'array',
        default: []
    },
    email: {
        type: 'string',
        //required: true      // removed for player import
    },
    phone: {
        type: 'string',
        //required: true      // removed for player import
    },
    bankId: {                  // It is bank account number
        type: 'string'
    },
    loyaltyPoints: {
        type: 'number',
        default: 0
    },
    points: {
        type: 'number',
        default: 0
    },
    walletAmount: {
        type: 'number'
    },
    soundOn: {
        type: 'boolean'
    },
    role: {
        type: 'string'
    },
    monthlyWalletAmountLimit: {
        type: 'number'
    },
    monthlyWallet: {
        type: 'boolean'
    },
    isDailyAttendance: {
        type: 'boolean',
        default: false
    },
    isDeleted: {
        type: 'boolean',
        default: false
    },
    storeVoucherCode: {
        type: 'array',
        default: []
    },
    statisticsgame1: {
        type: 'object',
        default: {

            "totalGames": 0,
            "totalGamesWin": 0,
            "totalGamesLoss": 0,
            "totalWinning": 0

        }
    },
    statisticsgame2: {
        type: 'object',
        default: {

            "totalGames": 0,
            "totalGamesWin": 0,
            "totalGamesLoss": 0,
            "totalWinning": 0

        }
    },
    statisticsgame3: {
        type: 'object',
        default: {

            "totalGames": 0,
            "totalGamesWin": 0,
            "totalGamesLoss": 0,
            "totalWinning": 0

        }
    },
    statisticsgame4: {
        type: 'object',
        default: {

            "totalGames": 0,
            "totalGamesWin": 0,
            "totalGamesLoss": 0,
            "totalWinning": 0

        }
    },
    statisticsgame5: {
        type: 'object',
        default: {

            "totalGames": 0,
            "totalGamesWin": 0,
            "totalGamesLoss": 0,
            "totalWinning": 0

        }
    },
    password: {
        type: 'string',
        required: true
    },
    profilePic: {
        type: 'array',
        default: []
    },
    userProfilePic: {
        type: 'string',
        default: '/assets/profilePic/gameUser.jpg'
    },
    status: {
        type: 'string',
        default: 'Active'
    },
    resetPasswordToken: {
        type: 'string',
    },
    resetPasswordExpires: {
        type: 'string',
    },
    socketId: {
        type: 'string',
        default: ''
    },
    firebaseToken: {
        type: 'string',
        default: ''
    },
    userType: {
        type: 'string',
        default: 'Online'
    },
    agentId: {
        type: 'string',
        default: ''
    },
    uniqueBalance: {
        type: 'number',
        default: 0
    },
    HR: {
        type: 'string',
        default: 'no'
    },
    
    PEP: {
        type: 'string',
        default: 'no'
    },
    photoId: {
        type: 'array',
        default: []
    },
    uniquePurchaseDate: { type: Date, default: new Date() },
    uniqueExpiryDate: { type: Date, default: new Date() },
    hoursValidity: { type: 'number',default: 0 },
    uniquePaymentType:{type : 'string'},
    withdrawEnabledUnique: { type: 'boolean', default: false },
    isCreatedByAdmin: { type: 'boolean',default: true},
    createrId: {type: Schema.Types.ObjectId},
    uniqueId: {type: 'string', default: ''},
    isLuckyNumberEnabled: { type: 'boolean',default: false},
    luckyNumber: { type: 'number',default: 1 },
    surname: { type: 'string' },  // Client change: surname to Lastname  , required: true  removed for player import
    selectedLanguage: {type: 'string', default: 'nor'},
    customerNumber: { type: 'number', unique: true },
    otherData: Schema.Types.Mixed, // add emailSent field For Import Player, add authToken to verify api call
    approvedHalls: {
        type: 'array',
        default: []
    },
    hallApprovedBy: {
        type: 'object',
        default: {}
    },
    playerAgent: {
        type: 'object',
        default: {}
    },
    startBreakTime: { type: Date, default: new Date(), default:null },
    endBreakTime: { type: Date, default: new Date(), default:null },
    pepDetails: {
        residentialAddressInNorway: { type: Boolean, default: false }, // Answer to "Do you have a residential address in Norway?"
        name: { type: String, default: null }, // Name of PEP (Navn på PEP)
        relationship: { type: String, default: null }, // Relationship to the PEP (Din relasjon til PEP)
        dateOfBirth: { type: Date, default: null }, // PEP's date of birth (Fødselsdato)
        incomeSources: {
          salary: { type: Boolean, default: false }, // Lønn (Salary)
          propertySaleOrLease: { type: Boolean, default: false }, // Salg/utleie av eiendom (Sale/Lease of Property)
          stocks: { type: Boolean, default: false }, // Aksjer (Stocks)
          socialSupport: { type: Boolean, default: false }, // Trygd, pensjon eller andre støtteordninger (Social Security, Pension, or Other Support Schemes)
          giftsOrInheritance: { type: Boolean, default: false }, // Gaver, arv eller lignende (Gifts, Inheritance, or Similar)
          other: { type: Boolean, default: false }, // Annet (Other)
        },
    },
    bankIdAuth: {               // Bank id verification data
        type: 'object',
        default: {}
    },
    isAlreadyApproved: {  // true for already approved players in system before implementing bankid or verified concept and also for excel import players
        type: 'boolean',
        default: false
    },
    // isVerified: {
    //     type: 'boolean',
    //     default: false
    // },
    isVerifiedByHall: {  // true if verified by hall agents
        type: 'boolean',
        default: false
    },
    riskCategory: {   // Risk Category bydefault will be low for new and old players
        type: 'string',
        enum: ['Low', 'Medium', 'High'],
        default: 'Low',
    },
    riskComment: {
        type: 'string',
        default: '',
    },
    addressDetails: {
        residentialAddressInNorway: { type: Boolean, default: false }, // Answer to "Do you have a residential address in Norway?"
        city: { type: String, default: null }, // City of the player
        zipCode: { type: String, default: null }, // Zip code of the player
        address: { type: String, default: null }, // Address of the player
        country: { type: String, default: null }, // Country of the player
        incomeSources: {
          salary: { type: Boolean, default: false }, // Lønn (Salary)
          propertySaleOrLease: { type: Boolean, default: false }, // Salg/utleie av eiendom (Sale/Lease of Property)
          stocks: { type: Boolean, default: false }, // Aksjer (Stocks)
          socialSupport: { type: Boolean, default: false }, // Trygd, pensjon eller andre støtteordninger (Social Security, Pension, or Other Support Schemes)
          giftsOrInheritance: { type: Boolean, default: false }, // Gaver, arv eller lignende (Gifts, Inheritance, or Similar)
          other: { type: Boolean, default: false }, // Annet (Other)
        },
    },
    blockRules: [{
        hallId: { type: String, required: true },
        gameTypes: [{
            name: String,
            subTypes: [String]
        }],
        days: { type: Number, required: true },
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now }
    }],
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'player', versionKey: false });

mongoose.model('player', PlayerSchema);