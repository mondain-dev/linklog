var fs = require('fs');
var URL = require('url').URL

var toml = require('@iarna/toml');
var cheerio = require("cheerio");
var RSSParser = require('rss-parser');
let rssParser = new RSSParser();
var RSS = require('rss');

var feed_config = toml.parse(fs.readFileSync('feeds.toml', 'utf8')).feeds;


let extractTitle = (str) => {
    return str.replace(/(<([^>]+)>)/ig, '\n').split('\n').filter(Boolean)[0];
}

let extractLinks = async (entry, excludes, css_selector = 'a') => {
    const $ = cheerio.load(entry['content:encoded']);
    let links = [];
    $(css_selector).each( async function () {
        if (excludes.every((t)=>{return !$(this).attr('href').includes(t)})){
            let link_url = $(this).attr('href');
            let link_title = extractTitle($(this).html());
            let link_description = "<p>URL: <a href=\"" + $(this).attr('href') +"\">" + $(this).attr('href')  + "</a></p><p>source: <a href=\"" + entry.link +"\">" + entry.title + "</a></p>";
            let link_entry = {
                url: link_url, 
                title: link_title,
                description: link_description,
                date: entry.pubDate,
                author: entry.author,
            };
            if( ! links.map((e)=> {return e.url}).includes(link_entry.url) ){
                links.push(link_entry);
            }
        }       
    });
    return links;
}

let loadFeeds = async (feed_config) => {
    let entries = [];
    for(const f of feed_config)
    {
        await rssParser.parseURL(f.url).then( async (feed_content) => {
            for(let entry of feed_content.items)
            {
                let include_entry = true;
                if('entry' in f){
                    if('includes' in f.entry){
                        if(!entry[f.entry.includes.target].toLowerCase().includes(f.entry.includes.term.toLowerCase())){
                            include_entry = false;
                        }
                    }
                }
                if('recent' in f){
                    if ('pubDate' in entry && f.recent > 0){
                        if( Date.now() - Date.parse(entry.pubDate) > 3600 * 24 * 1000 * f.recent ){
                            include_entry = false;
                        } 
                    }                    
                }
                if(include_entry){
                    let extracted_links = await extractLinks(entry, f.link.excludes, f.link.selector);
                    entries.push(...extracted_links);
                }
            }
        });
    }
    return entries;
}

let output_feed = new RSS({title:"Linklog", feed_url:"https://mondain-dev.github.io/linklog/index.xml", site_url:"https://github.com/mondain-dev/linklog/"});


loadFeeds(feed_config).then((items) => {
    for(let item of items){
        output_feed.item(item);
    }
}).then(() => {
    fs.writeFile('build/index.xml', output_feed.xml(), function (err) {
        if (err) return console.log(err);});
});

