var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

var htmlEncodingSniffer = require("html-encoding-sniffer");
var whatwgEncoding = require("whatwg-encoding");
var metascraper = require('metascraper')([
    require('metascraper-description')(),
    require('metascraper-image')(),
    require('metascraper-title')()
])

// var cheerio = require('cheerio')

var pjson  = require('./package.json');
const userAgent   = pjson.name + "/" + pjson.version;
const userEmail   = (process.env.GITHUB_ACTOR || 'github-pages-deploy-action') + '@users.noreply.' + 
                    (process.env.GITHUB_SERVER_URL ? parseURL(process.env.GITHUB_SERVER_URL).host : 'github.com')

function followUrl(url, fetchOptions) {
    return new Promise((resolve, reject) => {
        let finalUrl = url;
        fetch(url, fetchOptions)
          .then((res) => {
            if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
              finalUrl = res.headers.get('location');
              return followUrl(finalUrl, fetchOptions);
            } else {
              resolve({ finalUrl, finalRes: res });
            }
          })
          .then((finalUrlAndRes) => resolve(finalUrlAndRes))
          .catch((err) => reject(err));
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
                let {finalUrl: finalUrl, finalRes: res} = await followUrl(this.url, {redirect: 'manual', timeout: this.config.timeout ? this.config.timeout : 5000, headers: this.getHeadersForURL()});
                this.finalUrl = finalUrl;
                this.finalUrlParsed = parseURL(this.finalUrl);
                this.needScraper = this.needScraper || this.config.domainsUseScraper.some((s) =>
                    this.finalUrlParsed.host == s || 
                    this.finalUrlParsed.host.endsWith('.'+s)
                );
                
                if('status' in res){
                    if(res.status >= 200 && res.status < 300){
                        this.statusOk = true;
                        this.response = res;
                        this.contentType = res.headers.get('content-type');
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
                        let buf = Buffer.from(await this.response.arrayBuffer());
                        this.html = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));
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
            this.metadata = await metascraper({html: await this.getHTML(), url: this.finalUrl ? this.finalUrl : this.url});
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
                    await this.getMetaData();
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
                    await this.getMetaData();
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
            if(this.html == null)
            {
                await this.getHTML();
            }
            if(this.image == null)
            {
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
                    await this.getMetaData();
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
