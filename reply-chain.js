const replies = [

"Bu içerikte sizin dikkatinizi çeken detay ne?",
"Bence en kritik nokta şu:",
"Bu pozisyonda siz olsanız ne yapardınız?",
"Bu trend sizce nereye gider?"

];

function randomReply(){

 return replies[
  Math.floor(Math.random()*replies.length)
 ];

}

module.exports = randomReply;