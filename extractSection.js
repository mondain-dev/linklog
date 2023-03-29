const cheerio = require('cheerio');

function extractSection(html, includes){
  const $ = cheerio.load(html);
  let selected_html = '';

  for(var level = 1; level <= 6; level++){
    let found = false;
    let headings = $('h' + level);
    for(let i = 0; i < $('h' + level).length; i++)
    {
      let heading = $(headings[i]);
      if($(heading).text().toLowerCase().includes(includes)){
        found = true;
        let upperLevels = Array.from({length: level}, (_, j) => j + 1).map( l => 'h'+l).join(',')
        $(heading).nextUntil(upperLevels).each( (_, elem) => {
          selected_html += $.html(elem);
        });
      }
    }
    if(found){
      break;
    }
  };
  return(selected_html);
}

module.exports = extractSection;
