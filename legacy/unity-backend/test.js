// 'use strict'



// const first = permute('222111').concat(permute('321111'))
// console.log('first: ',first);
// const middle = permute('331111').concat(permute('322111')).concat(permute('222211'))
// const last = permute('332111').concat(permute('322211')).concat(permute('222221'))

// let ss = updateBingoSerie();




// function startBingo () {
//   const balls = []
//   for (let i = 1; i <= 90; i++) {
//     balls.push(i)
//   }
//   const id = setInterval(nextBall, 400)
//   function nextBall () {
//     if (balls.length === 0) clearInterval(id)
//     const ball = balls.splice(random(balls.length), 1)[0]
//     const cell = document.querySelector(`.ticket__number[data-key="${ball}"]`)
//     if (!cell) return
//     cell.classList.add('-is-marked')
//     if (checkFullTicket()) {
//       console.log('WIN')
//       clearInterval(id)
//     } 
//   }

//   function checkFullTicket () {
//     const tickets = document.querySelectorAll('.ticket')
//     for (let e = 0; e < tickets.length; e++) {
//       if (tickets[e].querySelectorAll('.-is-marked').length === 15) return true
//     }
//     return false
//   }
// }





// function updateBingoSerie () {
//   const afirst = permute('222111').concat(permute('321111'))
// const amiddle = permute('331111').concat(permute('322111')).concat(permute('222211'))
// const alast = permute('332111').concat(permute('322211')).concat(permute('222221'))


//     console.log('afirst: ',afirst);

//   const bingoSerie = new Serie()

//   generateSerie(0, bingoSerie)
//   const serie = new BingoSerie()
//   console.log('serie: ',serie);

//   const ticketElements = 5;
//   const ticketElementsArr = [];
//   for (let e = 0; e < ticketElements; e++) {
//     const ticket = new BingoTicket(bingoSerie.data[e])
//     console.log('ticket: ',ticket);
//     ticket.data.forEach((row, i) => {
//       row.forEach((item, j) => {
//         const index = i * 9 + j
//         const newCell =[]
//         if (item === 0) {
//         //   console.log('sdrr');
//         newCell.push(0)
//         } else {
//           let tp = serie.selectNext(j)
//           newCell.push(tp)
//         }
//         if (index < ticketElements) {
//             // console.log('sdrr32');
//             ticketElementsArr.push(newCell);
//         } else {
//             ticketElementsArr.push(newCell);
//         }
//         // console.log('newCell: ',newCell);
//       })
//     })
//   }
// //   console.log('ticketElementsArr: ',ticketElementsArr);
// }

// function random (maxValue) {
//   return Math.floor(Math.random() * maxValue)
// }

// function BingoSerie () {
//   this.data = [
//     [1, 2, 3, 4, 5, 6, 7, 8, 9],
//     [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
//     [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
//     [30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
//     [40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
//     [50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
//     [60, 61, 62, 63, 64, 65, 66, 67, 68, 69],
//     [70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
//     [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]
//   ]
//   this.selectNext = function (column) {
//     const arr = this.data[column]
//     const index = random(arr.length)
//     this.data[column] = arr.slice(0, index).concat(arr.slice(index + 1))
//     return arr[index]
//   }
// }

// function BingoTicket (ticket) {
//   this.data = [
//     [0, 0, 0, 0, 0, 0, 0, 0, 0],
//     [0, 0, 0, 0, 0, 0, 0, 0, 0],
//     [0, 0, 0, 0, 0, 0, 0, 0, 0]
//   ]

//   function selectRandomRow (obj, rowControl, col) {
//     const candidates = rowControl.available(obj, col)
//     const selection = Number(candidates[random(candidates.length)])
//     obj.data[selection][col] = 1
//     rowControl.increase(selection)
//   }

//   function init (obj) {
//     const arr = ticket.slice(0)
//     const rows = {
//       one: 0,
//       two: 0,
//       three: 0,
//       available: function (obj, col) {
//         let s = ''
//         if (this.one < 5 && obj.data[0][col] === 0) s = '0'
//         if (this.two < 5 && obj.data[1][col] === 0) s = s + '1'
//         if (this.three < 5 && obj.data[2][col] === 0) s = s + '2'
//         return s
//       },
//       increase: function (value) {
//         if (value === 0) {
//           this.one++
//         } else if (value === 1) {
//           this.two++
//         } else if (value === 2) {
//           this.three++
//         }
//       }
//     }
//     // Process Number 3
//     arr.forEach((element, index) => {
//       if (element === 3) {
//         for (let i = 0; i < 3; i++) {
//           selectRandomRow(obj, rows, index)
//         }
//       }
//     })
//     // Process Number 2
//     arr.forEach((element, index) => {
//       if (element === 2) {
//         for (let i = 0; i < 2; i++) {
//           selectRandomRow(obj, rows, index)
//         }
//       }
//     })
//     // Process Number 1
//     arr.forEach((element, index) => {
//       if (element === 1) {
//         selectRandomRow(obj, rows, index)
//       }
//     })
//   }

//   init(this)
// }

// function Serie () {
//   this.data = []
//   function init (obj) {
//     for (let i = 0; i < 6; i++) {
//       obj.data.push(Array(9).fill(0))
//     }
//   }
//   this.fillColumn = function (col, arr) {
//     arr.forEach((v, i) => { this.data[i][col] = Number(v) })
//   }
//   this.cleanColumn = function (col) {
//     for (let i = 0; i < 6; i++) {
//       this.data[i][col] = 0
//     }
//   }
//   this.isValid = function (index) {
//     return !this.data.some((row, ri) => {
//       let sum = row.reduce((total, v) => {
//         return total + v
//       }, 0)
//       if ((sum + 8 - index) > 15) return true
//       return false
//     })
//   }
//   this.toString = function () {
//     return this.data.reduce((arr, v) => {
//       arr.push(v.join(''))
//       return arr
//     }, [])
//   }

//   init(this)
// }

// function permute (str) {
//   const arrPermutes = []
//   const obj = str.split('').reduce((o, v) => {
//     if (o.hasOwnProperty(v)) {
//       o[v]++
//     } else {
//       o[v] = 1
//     }
//     return o
//   }, {})
//   function permutes (result, elements) {
//     if (Object.keys(elements).length === 1 && Object.values(elements)[0] === 1) {
//       arrPermutes.push(result + Object.keys(elements)[0])
//     } else {
//       const local = Object.assign({}, elements)
//       const arr = Object.keys(elements)
//       arr.forEach(k => {
//         const v = local[k]
//         if (v === 1) {
//           delete local[k]
//         } else {
//           local[k]--
//         }
//         permutes(result + k, local)
//         local[k] = v
//       })
//     }
//   }
//   permutes('', obj)
//   return arrPermutes
// }

// function generateSerie (index, serie) {
//   let local = []
//   switch (index) {
//     case 0:
//       local = first.slice(0)
//       break
//     case 8:
//       local = last.slice(0)
//       break
//     default:
//       local = middle.slice(0)
//   }

//   let result = false
//   while (!result && local.length > 0) {
//     const test = local.splice(random(local.length), 1)[0]
//     serie.fillColumn(index, test.split(''))
//     if (serie.isValid(index)) {
//       if (index === 8) return true
//       result = generateSerie(index + 1, serie)
//     } else {
//       serie.cleanColumn(index)
//     }
//   }
//   return result
// }


// var usedNums = new Array(75);

// let rowCol = 5;
// let comCol = 5;
// let tCon = (rowCol * comCol);
// const ticket = [];
// newCard();

// function newCard() {
//     for (var i = 0; i < tCon; i++) {
//         setSquare(i);
//     }
// }

// function setSquare(thisSquare) {
//     let sd = thisSquare;
//     var colPlace = new Array();
//     for (let i = 0; i < rowCol; i++) {
//         for (let j = 0; j < comCol; j++) {
//             colPlace.push(i)
//         }
//     }
//     var colBasis = colPlace[thisSquare] * 15;
//     var newNum;
//     do {
//         newNum = colBasis + getNewNum() + 1;
//     }
//     while (usedNums[newNum]);
//     usedNums[newNum] = true;

//     var innerObj = {};
//     innerObj[sd] = newNum;
//     ticket.push(innerObj);
// }

// function getNewNum() {
//     return Math.floor(Math.random() * 15);
// }
// console.log('ticket: ', ticket);


let arrVal = 15;
let ticketArray = [];
let r = 0;
while (ticketArray.length < arrVal) {
    if (ticketArray.length % 3 == 0) {
        r = getRandomArbitrary(1, 30);
    } else if (ticketArray.length % 3 == 1) {
        r = getRandomArbitrary(30, 60);
    } else if (ticketArray.length % 3 == 2) {
        r = getRandomArbitrary(60, 90);
    }

    // else if (ticketArray.length % 5 == 3) {
    //     r = getRandomArbitrary(45, 60);
    // } else if (ticketArray.length % 5 == 4) {
    //     r = getRandomArbitrary(60, 75);
    // }
    if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
}
console.log("ticketsss", ticketArray)

function getRandomArbitrary(max, min) {
    return Math.floor(Math.random() * (max - min)) + min;
}