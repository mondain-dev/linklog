var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// var AbortController = require("node-abort-controller").AbortController;

var { http, https } = require('follow-redirects');

var htmlEncodingSniffer = require("html-encoding-sniffer");
var whatwgEncoding = require("whatwg-encoding");
var metascraper = require('metascraper')([
    require('metascraper-description')(),
    require('metascraper-image')(),
    require('metascraper-title')()
])

var cheerio = require('cheerio')

var pjson  = require('./package.json');
const userAgent   = pjson.name + "/" + pjson.version;
const userEmail   = (process.env.GITHUB_ACTOR || 'github-pages-deploy-action') + '@users.noreply.' + 
                    (process.env.GITHUB_SERVER_URL ? parseURL(process.env.GITHUB_SERVER_URL).host : 'github.com')

function followUrl(url) {
    const get = url.startsWith('https') ? https.get : http.get
    
    return new Promise((resolve, reject) => {
        const request = get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            followUrl(res.headers.location)
              .then((finalUrlAndRes) => resolve(finalUrlAndRes))
              .catch((err) => reject(err));
          } else {
            resolve({ finalUrl: url, finalRes: res });
          }
        }).on('error', (err) => {
          reject(err);
        });
        
        setTimeout(() => {
            request.abort();
            reject(new Error(`Timeout for ${url}`));
          }, 5000);
        });
}

class LinkContent{
    constructor(url, config) {
        this.config = config;
        
        this.url = url;
        this.urlParsed = parseURL(url);
        this.needScraper = this.config.domainsUseScraper.some((s)=>
            this.urlParsed.host == s || 
            this.urlParsed.host.endsWith('.'+s)
        );

        this.urlChecked = false;
        this.finalUrl = null;
        this.finalUrlParsed = null;

        this.response = null;
        this.statusOk   = false;
        this.contentType = ''; 
        this.html = null;
        this.metadata = null;

        this.title = null;
        this.description = null;
        this.image = null;
    }

    getHeadersForURL(){
        if(this.config.domainsCustomUserAgent.some((s)=>{return this.urlParsed.host == s || this.urlParsed.host.endsWith('.'+s)}))
        {
            return {'User-Agent': userAgent, 'From': userEmail};
        }
        else{
            return {'User-Agent': 'facebookexternalhit'};
        }
    }

    async checkUrl(){
        try{
            if(!this.needScraper){
                let {finalUrl: finalUrl, finalRes: res} = await followUrl(this.url);
                this.finalUrl = finalUrl;
                this.finalUrlParsed = parseURL(this.finalUrl);
                this.needScraper = this.needScraper || this.config.domainsUseScraper.some((s) =>
                    this.finalUrlParsed.host == s || 
                    this.finalUrlParsed.host.endsWith('.'+s)
                );
                
                if('statusCode' in res){
                    if(res.statusCode >= 200 && res.statusCode < 300){
                        this.statusOk = true;
                        this.response = res;
                        this.contentType = res.headers['content-type'];
                    }
                } 
            }
            this.urlChecked = true; 
        }
        catch(error){
            console.log("Check " + this.url + " failed.");
            console.log(error);
        }

    }

    async getHTMLScraper(){
        let endpoint = new URL(this.config.endpointScraper); 
        endpoint.searchParams.append("api_key", process.env.SCRAPER_API_KEY);
        endpoint.searchParams.append("url", this.url);
        let html = ''
        try{
            let res = await fetch(endpoint.href);
            let buf = Buffer.from(await res.arrayBuffer());
            html = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));
        }
        catch(e){}
        return html;
    }

    async getHTML(){
        if(this.html == null)
        {
            if(this.needScraper){
                this.html = await this.getHTMLScraper();
            }
            else{
                if(!this.urlChecked){
                    await this.checkUrl();
                }
                if( this.needScraper )
                {
                    this.html = await this.getHTMLScraper();
                }
                else if(this.statusOk && this.contentType.startsWith('text/html')){
                    try{
                        const htmlPromise = new Promise((resolve, reject) => {
                            let html = '';
                            this.response.on('data', (chunk) => {
                              html += chunk;
                            });
                            this.response.on('end', () => {
                              resolve(html);
                            });
                            this.response.on('error', (err) => {
                              reject(err);
                            });
                          });
                          this.html = await htmlPromise;
                    }
                    catch(e){
                        console.log("getHTML failed: " + this.url);
                        console.log(e);
                        this.html = '';
                    }
                }
                else{
                    this.html = ''; 
                }
            }
        }
        return this.html;
    }

    async getMetaData(){
        if (!this.metadata)
        {
            this.metadata = await metascraper({html: await this.getHTML(), url: this.url});
        }
        return this.metadata;
    }

    async getTitle(){
        if(!this.urlChecked){
            await this.checkUrl();
        }
        if((this.statusOk && this.contentType.startsWith('text/html')) || this.needScraper ){
            if(this.html == null){
                await this.getHTML();
            }
            if(this.title == null){
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'headline' in ld)
                                {
                                    this.title = ld['headline'];
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.title == null)
            {
                // metascraper
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.title = this.metadata.title;
            }
        }
        if(this.title == null)
        {
            if(this.statusOk && this.contentType.startsWith('image'))
            {
                this.title = "[image]"
            }
        }
        if(this.title == null)
        {
            this.title = "";
        }
        return this.title;
    }

    async getDescription(){
        if(!this.urlChecked){
            await this.checkUrl();
        }
        if((this.statusOk && this.contentType.startsWith('text/html')) || this.needScraper ){
            if(this.html == null)
            {
                await this.getHTML();
            }
            if(this.description == null)
            {
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'description' in ld)
                                {
                                    this.description = ld['description'];
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.description == null)
            {
                // metascraper
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.description = this.metadata.description;
            }
        }
        if(this.description == null){
            this.description = "";
        }
        return this.description;
    }

    async getImage(){
        if(!this.urlChecked){
            await this.checkUrl();
        }
        if((this.statusOk && this.contentType.startsWith('text/html')) || this.needScraper ){                
            if(this.image == null)
            {
                if(this.html == null)
                {
                    await this.getHTML();
                }
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'image' in ld)
                                {
                                    this.image = ld['image'].url;
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.image == null)
            {
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.image = this.metadata.image;
            }
        }
        else if (this.statusOk && this.contentType.startsWith('image')){
            this.image = this.finalUrl;
        }
        if(this.image == null)
        {
            this.image == "";
        }
        return this.image;
    }

    async renderContent(){
        let imgDescription = ""
        let textDescription = "";
        if(!this.urlChecked)
        {
            await this.checkUrl();
        }
        if(this.contentType.startsWith('text/html')){
            if((await this.getImage())){
                imgDescription = "<p><img src=\"" + (await this.getImage()) + "\"></p>";
            }
            if((await this.getTitle()))
            {
                textDescription += '<p>' + (await this.getTitle()) + '</p>';
            }
            if((await this.getDescription())){
                textDescription += '<p>' + (await this.getDescription()) + '</p>';
            }
        }
        else if(this.contentType.startsWith('image')){
            imgDescription = "<p><img src=\"" + this.finalUrl + "\"></p>";
        }
        return imgDescription + textDescription;  
    }
}

module.exports = LinkContent;
