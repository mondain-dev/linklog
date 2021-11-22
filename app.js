var fs = require('fs');
var URL = require('url').URL

var toml = require('@iarna/toml');
var cheerio = require("cheerio");
var RSSParser = require('rss-parser');
let rssParser = new RSSParser();
var RSS = require('rss');

var feedConfig = toml.parse(fs.readFileSync('feeds.toml', 'utf8')).feeds;

function validateURL(string) {
    try {
      let url = new URL(string);
    } catch (_) {
      return false;  
    }
    return true;
}

let extractTitle = (strHTML) => {
    texts = strHTML.trim().replace(/(<([^>]+)>)/ig, '\n').split('\n').map(e => e.trim()).filter(Boolean);
    if(texts){
        return texts[0].trim();
    }
    else{
        return '';
    }
}

let extractLinks = async (entry, excludes, cssSelector = 'a') => {
    let entryContent = '';
    if('content:encoded' in entry){
        entryContent = entry['content:encoded'];
    }
    else if('content' in entry){
        entryContent = entry['content'];
    }else if('description' in entry){
        entryContent = entry['description'];
    }
    let links = [];
    if(entryContent){
        const $ = cheerio.load(entryContent);
        $(cssSelector).each( async function () {
            if (excludes.every((t)=>{return !$(this).attr('href').includes(t) && !$(this).text().includes(t) })){
                let linkURL = $(this).attr('href');
                if (validateURL(linkURL))
                {
                    let linkTitle = extractTitle($(this).html());
                    if(!linkTitle){
                        linkTitle = linkURL;
                    }
                    let linkDescription = "<p>URL: <a href=\"" + linkURL +"\">" + linkURL  + "</a></p><p>source: <a href=\"" + entry.link +"\">" + entry.title + "</a></p>";
                    let linkEntry = {
                        url: linkURL, 
                        title: linkTitle,
                        description: linkDescription,
                        date: entry.pubDate,
                        author: entry.author,
                    };
                    if( ! links.map((e)=> {return e.url}).includes(linkEntry.url) ){
                        links.push(linkEntry);
                    }
                }
            }       
        });
    }
    return links;
}

let loadFeeds = async (feedConfig) => {
    let entries = [];
    for(const f of feedConfig)
    {
        await rssParser.parseURL(f.url).then( async (feedContent) => {
            for(let entry of feedContent.items)
            {
                let includeEntry = true;
                if('entry' in f){
                    if('includes' in f.entry){
                        if(!entry[f.entry.includes.target].toLowerCase().includes(f.entry.includes.keyword.toLowerCase())){
                            includeEntry = false;
                        }
                    }
                }
                if('recent' in f){
                    if ('pubDate' in entry && f.recent > 0){
                        if( Date.now() - Date.parse(entry.pubDate) > 3600 * 24 * 1000 * f.recent ){
                            includeEntry = false;
                        } 
                    }                    
                }
                if(includeEntry){
                    let extractedLinks = await extractLinks(entry, f.link.excludes, f.link.selector);
                    entries.push(...extractedLinks);
                }
            }
        });
    }
    return entries;
}

let outputFeed = new RSS({title:"Linklog", feed_url:"https://mondain-dev.github.io/linklog/index.xml", site_url:"https://github.com/mondain-dev/linklog"});

loadFeeds(feedConfig).then((items) => {
    for(let item of items){
        outputFeed.item(item);
    }
}).then(() => {
    fs.writeFile('build/index.xml', outputFeed.xml(), function (err) {
        if (err) return console.log(err);});
});
