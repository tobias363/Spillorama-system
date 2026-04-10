module.exports = {

    numFormater: function(num) {
        try {
            var si = [
                { value: 1, symbol: "" },
                { value: 1E3, symbol: "k" },
                { value: 1E6, symbol: "M" },
                { value: 1E9, symbol: "G" },
                { value: 1E12, symbol: "T" },
                { value: 1E15, symbol: "P" },
                { value: 1E18, symbol: "E" }
            ];
            var rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
            var i;
            for (i = si.length - 1; i > 0; i--) {
                if (num >= si[i].value) {
                    break;
                }
            }
            return (num / si[i].value).toFixed(0).replace(rx, "$1") + si[i].symbol;
        } catch (e) {
            console.log("")
            return 0;
        }
    },
    getAgoTime: function(date) {
        let incommingDate = new Date(date);
        let currentDate = new Date();
        // let currentTimeUtc =new Date(
        //   date.getUTCFullYear(),
        //   date.getUTCMonth(),
        //   date.getUTCDate(),
        //   date.getUTCHours(),
        //   date.getUTCMinutes(), 
        //   date.getUTCSeconds()
        // );
        let seconds = (currentDate.getTime() - incommingDate.getTime()) / 1000;
        console.log(seconds)
        let message = "few seconds ago"
        if (seconds > 60) {
            if (Math.floor(seconds / (24 * 60 * 60)) < 1) {
                if (Math.floor(seconds / 3600) < 1) {
                    message = (Math.floor(seconds % 3600 / 60)) + " minutes ago";
                } else {
                    if (Math.floor(seconds / 3600) == 1) {
                        message = (Math.floor(seconds / 3600)) + " hour ago";
                    } else {
                        message = (Math.floor(seconds / 3600)) + " hours ago";
                    }
                }
            } else {
                message = (Math.floor(seconds / (24 * 60 * 60))) + " day ago";
            }
        }
        return message;
    },

}