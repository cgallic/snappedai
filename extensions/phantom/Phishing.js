import{a as j,b as G}from"./chunk-JOCKIHY4.js";import{a as z}from"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import{a as A}from"./chunk-OR3XQXDJ.js";import"./chunk-HLSJ3VIL.js";import{d as J,db as p,k as M,m as c,s as $}from"./chunk-57EVB5FV.js";import"./chunk-W5EYARUT.js";import{f as E,k as _}from"./chunk-3H3VDE2B.js";import{a as y}from"./chunk-6L5OAXTQ.js";import"./chunk-EAEMLYNM.js";import{b as S,f as D}from"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import{t as I}from"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import{a as F}from"./chunk-NMTPXQAP.js";import{a as N}from"./chunk-SIWEHH3L.js";import{N as P}from"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import"./chunk-W7IWPUIQ.js";import{ib as oo}from"./chunk-4SCKDS7G.js";import{J as L,Nc as T,ed as U,wd as m}from"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{Ca as f,Z as C,a as v,b as l}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a as e,g as i,i as a,n as s}from"./chunk-WKJYWAXG.js";a();s();var Co=i(v(),1);var X=i(j(),1);a();s();var x=i(v(),1);a();s();var q=i(oo(),1);var o=i(l(),1),g=f.colors.legacy.spotNegative,to=c.div`
  position: fixed;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  background-color: ${f.colors.brand.white};
  padding: clamp(24px, 16vh, 256px) 24px;
  box-sizing: border-box;
`,ro=c.div`
  margin-bottom: 24px;
  padding-bottom: 8vh;
`,io=c.div`
  max-width: 100ch;
  margin: auto;

  * {
    text-align: left;
  }
`,K=c.a`
  text-decoration: underline;
  color: ${g};
`,h=new F,Q=e(({origin:r,subdomain:n})=>{let{t:d}=C(),b=r?D(r):"",Y=r??"",B=new URL(Y),k=B.hostname,W=n==="true"?k:b,w=(0,q.toUnicode)(W),Z=e(async()=>{if(n==="true"){let O=await h.get(m.UserWhitelistSubdomains),t=JSON.parse(`${O}`);t?t.push(k):t=[k],t=[...new Set(t)],h.set(m.UserWhitelistSubdomains,JSON.stringify(t))}else{let O=await h.get(m.UserWhitelistedOrigins),t=JSON.parse(`${O}`);t?t.push(b):t=[b],t=[...new Set(t)],h.set(m.UserWhitelistedOrigins,JSON.stringify(t))}["http:","https:"].includes(B.protocol)&&self.location.assign(r)},"handleClick");return(0,o.jsx)(to,{children:(0,o.jsxs)(io,{children:[(0,o.jsx)(ro,{children:(0,o.jsx)($,{width:128,fill:f.colors.brand.white})}),(0,o.jsx)(p,{size:30,color:g,weight:"600",children:d("blocklistOriginDomainIsBlocked",{domainName:w||d("blocklistOriginThisDomain")})}),(0,o.jsx)(p,{color:g,children:d("blocklistOriginSiteIsMalicious")}),(0,o.jsx)(p,{color:g,children:(0,o.jsxs)(I,{i18nKey:"blocklistOriginCommunityDatabaseInterpolated",children:["This site has been flagged as part of a",(0,o.jsx)(K,{href:S,rel:"noopener",target:"_blank",children:"community-maintained database"}),"of known phishing websites and scams. If you believe the site has been flagged in error,",(0,o.jsx)(K,{href:S,rel:"noopener",target:"_blank",children:"please file an issue"}),"."]})}),W?(0,o.jsx)(p,{color:g,onClick:Z,hoverUnderline:!0,children:d("blocklistOriginIgnoreWarning",{domainName:w})}):(0,o.jsx)(o.Fragment,{})]})})},"BlocklistOrigin");var u=i(l(),1),eo=e(()=>{let r;try{r=new URLSearchParams(self.location.search).get("origin")||"",new URL(r)}catch{r=""}return r},"getOriginParam"),no=e(()=>new URLSearchParams(self.location.search).get("subdomain")||"","getSubdomainParam"),V=e(()=>{let r=(0,x.useMemo)(()=>eo(),[]),n=(0,x.useMemo)(()=>no(),[]);return(0,u.jsx)(J,{future:{v7_startTransition:!0},children:(0,u.jsx)(z,{children:(0,u.jsx)(Q,{origin:r,subdomain:n})})})},"Blocklist");var R=i(l(),1);N();T([[U,y]]);L.init({provider:G});await P(y);await E("frontend",_);var ao=document.getElementById("root"),so=(0,X.createRoot)(ao);so.render((0,R.jsx)(M,{theme:A,children:(0,R.jsx)(V,{})}));
//# sourceMappingURL=Phishing.js.map
