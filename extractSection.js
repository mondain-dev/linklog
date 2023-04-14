const cheerio = require('cheerio');

function extractSection(html, includes){
  const $ = cheerio.load(html);
  let selected_html = '';

  for(const term of (Array.isArray(includes) ? includes : [includes])){
    for(var level = 1; level <= 6; level++){
      let found = false;
      for(const heading of $('h' + level))
      {
        if($(heading).text().toLowerCase().includes(term)){
          found = true;
          let upperLevels = Array.from({length: level}, (_, j) => j + 1).map( l => 'h'+l).join(',')
          $(heading).nextUntil(upperLevels).each( (_, elem) => {
            if(!selected_html.includes($.html(elem))){
              selected_html += $.html(elem);
            }
          });
        }
      }
      if(found){
        break;
      }
    };
  }
  return(selected_html);
}

module.exports = extractSection;
