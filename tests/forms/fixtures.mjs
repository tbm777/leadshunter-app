// Test forms for the form engine. Each one mimics a real pattern seen on small-business sites.
// The server validates every submission like a strict real backend would.
const today = () => new Date().toISOString().slice(0, 10);

const css = `<style>body{font-family:Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 16px}
label,.lbl{display:block;margin:10px 0 4px;font-size:14px}input:not([type=checkbox]):not([type=radio]),select,textarea{width:100%;padding:8px;box-sizing:border-box}
textarea{min-height:90px}button,input[type=submit]{margin-top:14px;padding:10px 18px}.field-error,.error{color:#b00020;font-size:13px}
.success{color:#0a7a2f}.opt{display:inline-flex;gap:6px;margin-right:14px}header,footer{background:#f3f3f3;padding:10px;margin:10px 0}</style>`;
const layout = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${css}
<script>function lhErr(el,msg){var d=document.createElement('div');d.className='field-error';d.textContent=msg;el.insertAdjacentElement('afterend',d);}</script>
</head><body><h1>${title}</h1><p>Family-owned since 1998. Call us or send a message below.</p>${body}</body></html>`;

// AJAX submit through FormData. `pre` may validate and `return` to block the submit.
const ajax = (id, pre = '') => `<div id="out" aria-live="polite"></div><script>
(function(){var f=document.getElementById('f');var out=document.getElementById('out');
f.addEventListener('submit',function(e){e.preventDefault();
document.querySelectorAll('.field-error').forEach(function(x){x.remove()});out.textContent='';
${pre}
fetch('/submit/${id}',{method:'POST',body:new FormData(f)}).then(function(r){return r.json()}).then(function(j){
if(j.ok){f.style.display='none';out.className='success';out.textContent="Thanks! We'll be in touch shortly.";}
else{out.className='error';out.setAttribute('role','alert');out.textContent=j.error;}});});})();
</script>`;

const opts = (list, placeholder) => (placeholder !== undefined ? `<option value="">${placeholder}</option>` : '') + list.map(o => Array.isArray(o) ? `<option value="${o[0]}">${o[1]}</option>` : `<option>${o}</option>`).join('');
const radios = (name, list) => list.map((o, i) => `<label class="opt"><input type="radio" name="${name}" value="${o}"${i === -1 ? '' : ''}> ${o}</label>`).join('');

const isEmail = v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v || '');

export const FIXTURES = [
  {
    id: 'plumbing-basic', industry: 'Plumbing', note: 'Plain HTML form, classic post', mode: 'html',
    req: ['your-name', 'your-email', 'your-message'],
    html: () => layout('Rapid Rooter Plumbing', `<form method="post" action="/submit/plumbing-basic"><!--ERR-->
      <label for="n">Your Name *</label><input id="n" name="your-name" required>
      <label for="e">Email *</label><input id="e" type="email" name="your-email" required>
      <label for="p">Phone</label><input id="p" type="tel" name="your-phone">
      <label for="m">How can we help? *</label><textarea id="m" name="your-message" required></textarea>
      <button type="submit">Send Message</button></form>`),
  },
  {
    id: 'dental-cf7', industry: 'Dentist', note: 'Contact Form 7: AJAX, split names, placeholder select, acceptance', mode: 'cf7',
    req: ['first-name', 'last-name', 'your-email', 'your-phone', 'service', 'acceptance-privacy', 'your-message'],
    html: () => layout('Bright Smile Dental', `<div class="wpcf7"><form id="f" class="wpcf7-form" novalidate>
      <p><label>First Name<span>*</span><br><span class="wpcf7-form-control-wrap" data-name="first-name"><input name="first-name" class="wpcf7-validates-as-required" aria-required="true"></span></label></p>
      <p><label>Last Name<span>*</span><br><span class="wpcf7-form-control-wrap" data-name="last-name"><input name="last-name" class="wpcf7-validates-as-required" aria-required="true"></span></label></p>
      <p><label>Email<span>*</span><br><span class="wpcf7-form-control-wrap" data-name="your-email"><input type="email" name="your-email" aria-required="true"></span></label></p>
      <p><label>Phone<span>*</span><br><span class="wpcf7-form-control-wrap" data-name="your-phone"><input type="tel" name="your-phone" aria-required="true"></span></label></p>
      <p><label>Service<br><span class="wpcf7-form-control-wrap" data-name="service"><select name="service" aria-required="true">${opts(['Cleaning', 'Whitening', 'Implants', 'Emergency visit'], '—Please choose an option—')}</select></span></label></p>
      <p><label>Message<br><span class="wpcf7-form-control-wrap" data-name="your-message"><textarea name="your-message" aria-required="true"></textarea></span></label></p>
      <p><span class="wpcf7-form-control-wrap" data-name="acceptance-privacy"><span class="wpcf7-acceptance"><label><input type="checkbox" name="acceptance-privacy" value="1"> I agree to the privacy policy</label></span></span></p>
      <p><input type="submit" value="Send" class="wpcf7-submit"></p>
      <div class="wpcf7-response-output" aria-hidden="true"></div></form></div>
      <script>(function(){var f=document.getElementById('f');f.addEventListener('submit',function(e){e.preventDefault();
        f.querySelectorAll('.wpcf7-not-valid-tip').forEach(function(x){x.remove()});
        fetch('/submit/dental-cf7',{method:'POST',body:new FormData(f)}).then(function(r){return r.json()}).then(function(j){
          var o=f.querySelector('.wpcf7-response-output');o.removeAttribute('aria-hidden');o.textContent=j.message;
          (j.invalid_fields||[]).forEach(function(x){var w=f.querySelector('[data-name="'+x.field+'"]');var s=document.createElement('span');s.className='wpcf7-not-valid-tip';s.textContent=x.message;w.appendChild(s);});
          if(j.status==='mail_sent'){f.reset();}
        });});})();</script>`),
  },
  {
    id: 'roofing-radios', industry: 'Roofing', note: 'Required radio groups', mode: 'json',
    req: ['name', 'email', 'phone', 'contact_method', 'property_type', 'details'],
    html: () => layout('Summit Roofing Co.', `<form id="f">
      <label for="a">Full name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <fieldset><legend>Preferred contact method *</legend>${radios('contact_method', ['Phone', 'Email', 'Text'])}</fieldset>
      <fieldset><legend>Property type *</legend><label class="opt"><input type="radio" name="property_type" value="Residential" required> Residential</label><label class="opt"><input type="radio" name="property_type" value="Commercial"> Commercial</label></fieldset>
      <label for="d">Describe the roof issue *</label><textarea id="d" name="details" required></textarea>
      <button>Request Inspection</button></form>${ajax('roofing-radios', "if(!f.querySelector('[name=contact_method]:checked')){lhErr(f.querySelector('fieldset legend'),'Please choose a contact method.');return;}")}`),
  },
  {
    id: 'salon-booking', industry: 'Hair salon', note: 'Date with min, time window, number range', mode: 'html',
    req: ['name', 'email', 'phone', 'date', 'time', 'guests'],
    check: (b) => (b.date < today() ? 'Please pick a future date.' : b.time < '09:00' || b.time > '17:00' ? 'Pick a time between 9am and 5pm.' : +b.guests < 1 || +b.guests > 6 ? 'Guests must be 1 to 6.' : null),
    html: () => layout('Luxe Hair Studio', `<form method="post" action="/submit/salon-booking"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="d">Preferred date *</label><input id="d" type="date" name="date" min="${today()}" required>
      <label for="t">Preferred time *</label><input id="t" type="time" name="time" min="09:00" max="17:00" step="900" required>
      <label for="g">Number of guests *</label><input id="g" type="number" name="guests" min="1" max="6" required>
      <label for="s">Stylist</label><select id="s" name="stylist">${opts(['Any stylist', 'Mia', 'Jordan'])}</select>
      <label for="n">Notes</label><textarea id="n" name="notes"></textarea>
      <button type="submit">Book Now</button></form>`),
  },
  {
    id: 'hvac-patterns', industry: 'HVAC', note: 'ZIP and phone pattern attributes', mode: 'html',
    req: ['name', 'email', 'phone', 'zip', 'system', 'message'],
    check: (b) => (!/^\(\d{3}\) \d{3}-\d{4}$/.test(b.phone) ? 'Phone must look like (555) 555-5555.' : !/^\d{5}$/.test(b.zip) ? 'ZIP must be 5 digits.' : null),
    html: () => layout('CoolAir HVAC', `<form method="post" action="/submit/hvac-patterns"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" name="phone" pattern="\\(\\d{3}\\) \\d{3}-\\d{4}" title="(555) 555-5555" required>
      <label for="z">ZIP code *</label><input id="z" name="zip" pattern="\\d{5}" inputmode="numeric" required>
      <label for="s">System type *</label><select id="s" name="system" required>${opts(['Central AC', 'Heat pump', 'Furnace', 'Ductless mini-split'], 'Select…')}</select>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Get Service</button></form>`),
  },
  {
    id: 'law-honeypot', industry: 'Law firm', note: 'Three spam traps that must stay empty, redirect', mode: 'redirect',
    req: ['full_name', 'email', 'phone', 'case_type', 'summary'], traps: ['fax', 'hp_email', 'url_confirm'],
    html: () => layout('Harper & Cole Law', `<form method="post" action="/submit/law-honeypot"><!--ERR-->
      <style>.hidden-field{opacity:0;position:absolute;height:0;width:0;z-index:-1}</style>
      <label for="a">Full name *</label><input id="a" name="full_name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <div style="position:absolute;left:-9999px"><label for="fx">Fax</label><input id="fx" name="fax" tabindex="-1" autocomplete="off"></div>
      <input name="hp_email" type="email" style="display:none">
      <input name="url_confirm" class="hidden-field" tabindex="-1">
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="t">Case type *</label><select id="t" name="case_type" required>${opts(['Personal injury', 'Family law', 'Estate planning', 'Business', 'Other'], 'Choose one')}</select>
      <label for="s">Brief summary of your case *</label><textarea id="s" name="summary" required></textarea>
      <button type="submit">Request Free Consultation</button></form>`),
  },
  {
    id: 'moving-multistep', industry: 'Moving company', note: '3-step wizard with per-step validation', mode: 'json',
    req: ['name', 'email', 'phone', 'move_date', 'size', 'from_zip', 'to_zip', 'consent'],
    html: () => layout('Swift Movers', `<form id="f" novalidate>
      <div class="step" data-s="1"><h3>Step 1 of 3: Contact</h3>
        <label for="a">Name *</label><input id="a" name="name" required>
        <label for="b">Email *</label><input id="b" type="email" name="email" required>
        <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
        <button type="button" class="next">Next</button></div>
      <div class="step" data-s="2" style="display:none"><h3>Step 2 of 3: Move details</h3>
        <label for="d">Move date *</label><input id="d" type="date" name="move_date" min="${today()}" required>
        <label for="e">Home size *</label><select id="e" name="size" required>${opts(['Studio', '1 bedroom', '2 bedrooms', '3+ bedrooms'], 'Select size')}</select>
        <label for="g">Moving from ZIP *</label><input id="g" name="from_zip" required>
        <label for="h">Moving to ZIP *</label><input id="h" name="to_zip" required>
        <button type="button" class="back">Back</button> <button type="button" class="next">Continue</button></div>
      <div class="step" data-s="3" style="display:none"><h3>Step 3 of 3: Anything else?</h3>
        <label for="i">Anything else we should know?</label><textarea id="i" name="notes"></textarea>
        <label><input type="checkbox" name="consent" value="yes" required> I agree to be contacted about my move *</label>
        <button type="button" class="back">Back</button> <button type="submit">Get My Quote</button></div>
    </form>${ajax('moving-multistep', "if(!f.querySelector('[name=consent]').checked){lhErr(f.querySelector('[name=consent]').closest('label'),'Please agree to be contacted.');return;}")}
    <script>(function(){var f=document.getElementById('f');var steps=[].slice.call(f.querySelectorAll('.step'));var cur=0;
      function show(i){steps.forEach(function(s,k){s.style.display=k===i?'':'none'});cur=i;}
      f.querySelectorAll('.next').forEach(function(b){b.onclick=function(){f.querySelectorAll('.field-error').forEach(function(x){x.remove()});var ok=true;
        steps[cur].querySelectorAll('[required]').forEach(function(el){if(!el.checkValidity()){ok=false;lhErr(el,'This field is required.');}});if(ok)show(cur+1);};});
      f.querySelectorAll('.back').forEach(function(b){b.onclick=function(){show(cur-1)};});})();</script>`),
  },
  {
    id: 'landscaping-conditional', industry: 'Landscaping', note: 'Choosing "Other" reveals a required field', mode: 'json',
    req: ['name', 'email', 'phone', 'service', 'message'],
    check: (b) => (b.service === 'Other' && !b.other_service ? 'Please describe the service you need.' : null),
    html: () => layout('GreenScape Landscaping', `<form id="f">
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="s">Service needed *</label><select id="s" name="service" required>${opts(['Lawn care', 'Tree trimming', 'Hardscaping', 'Irrigation', 'Other'], 'Select a service')}</select>
      <div id="ow" style="display:none"><label for="o">Please describe the service *</label><input id="o" name="other_service" maxlength="100"></div>
      <label><input type="checkbox" id="com" name="commercial" value="1"> This is a commercial property</label>
      <div id="cw" style="display:none"><label for="co">Company name *</label><input id="co" name="company"></div>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea>
      <button>Send Request</button></form>
      <script>(function(){var s=document.getElementById('s'),o=document.getElementById('o');s.addEventListener('change',function(){var on=s.value==='Other';document.getElementById('ow').style.display=on?'':'none';o.required=on;});
        var c=document.getElementById('com');c.addEventListener('change',function(){document.getElementById('cw').style.display=c.checked?'':'none';document.getElementById('co').required=c.checked;});})();</script>
      ${ajax('landscaping-conditional')}`),
  },
  {
    id: 'accounting-react', industry: 'Accounting', note: 'React-style controlled inputs, JS-only validation, JSON post', mode: 'json',
    req: ['name', 'email', 'phone', 'message'],
    check: (b) => (!/^\d{10}$/.test(b.phone) ? 'Phone number must contain only digits (10 digits).' : !/\s/.test(b.name.trim()) ? 'Please enter your first and last name.' : null),
    html: () => layout('Ledger & Co. CPAs', `<div id="app"><form id="f" novalidate>
      <div class="row"><label for="a">Full name</label><input id="a" data-k="name"></div>
      <div class="row"><label for="b">Email address</label><input id="b" data-k="email"></div>
      <div class="row"><label for="c">Phone number</label><input id="c" data-k="phone"></div>
      <div class="row"><label for="d">What can we help you with?</label><textarea id="d" data-k="message"></textarea></div>
      <button type="submit" class="btn-primary">Send</button><div id="out"></div></form></div>
      <script>(function(){var state={name:'',email:'',phone:'',message:''};var f=document.getElementById('f');
        f.querySelectorAll('[data-k]').forEach(function(el){el.addEventListener('input',function(){state[el.dataset.k]=el.value;});});
        f.addEventListener('submit',function(e){e.preventDefault();f.querySelectorAll('.field-error').forEach(function(x){x.remove()});var bad=false;
          function E(k,m){bad=true;lhErr(f.querySelector('[data-k='+k+']'),m);}
          if(!/\\s/.test(state.name.trim()))E('name','Please enter your first and last name.');
          if(!/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(state.email))E('email','Enter a valid email.');
          if(!/^\\d{10}$/.test(state.phone))E('phone','Phone number must contain only digits (10 digits).');
          if(state.message.length<20)E('message','Message must be at least 20 characters.');
          if(bad)return;
          fetch('/submit/accounting-react',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)}).then(function(r){return r.json()}).then(function(j){
            var out=document.getElementById('out');if(j.ok){f.innerHTML='<h2>Thank you! Your message has been sent.</h2>';}else{out.className='error';out.textContent=j.error;}});});})();</script>`),
  },
  {
    id: 'marketing-customselect', industry: 'Marketing agency', note: 'Two custom role=listbox dropdowns, hidden inputs', mode: 'json',
    req: ['name', 'email', 'service', 'budget', 'message'],
    html: () => layout('Northstar Marketing', `<style>.cs{border:1px solid #999;padding:8px;cursor:pointer}.cs-list{list-style:none;margin:0;padding:0;border:1px solid #999}.cs-list li{padding:6px 8px;cursor:pointer}.cs-list li:hover{background:#eee}</style>
      <form id="f" novalidate>
      <label for="a">Your name</label><input id="a" name="name">
      <label for="b">Work email</label><input id="b" type="email" name="email">
      <label id="svc-l">Service interested in *</label>
      <div class="cs" role="combobox" aria-labelledby="svc-l" aria-haspopup="listbox" aria-expanded="false" tabindex="0" data-for="service"><span>Select a service</span></div>
      <ul class="cs-list" role="listbox" hidden data-list="service"><li role="option" data-value="seo">SEO</li><li role="option" data-value="ppc">Paid ads</li><li role="option" data-value="social">Social media</li><li role="option" data-value="web">Web design</li></ul>
      <input type="hidden" name="service">
      <label id="bud-l">Monthly budget *</label>
      <div class="cs" role="combobox" aria-labelledby="bud-l" aria-haspopup="listbox" aria-expanded="false" tabindex="0" data-for="budget"><span>Choose a range</span></div>
      <ul class="cs-list" role="listbox" hidden data-list="budget"><li role="option" data-value="1">Under $1k</li><li role="option" data-value="2">$1k–$5k</li><li role="option" data-value="3">$5k+</li></ul>
      <input type="hidden" name="budget">
      <label for="m">Tell us about your goals</label><textarea id="m" name="message"></textarea>
      <button>Let's Talk</button></form>
      <script>(function(){document.querySelectorAll('.cs').forEach(function(c){var k=c.dataset.for;var l=document.querySelector('[data-list='+k+']');
        c.addEventListener('click',function(){l.hidden=!l.hidden;c.setAttribute('aria-expanded',String(!l.hidden));});
        l.querySelectorAll('li').forEach(function(li){li.addEventListener('click',function(){document.querySelector('[name='+k+']').value=li.dataset.value;c.querySelector('span').textContent=li.textContent;l.hidden=true;c.setAttribute('aria-expanded','false');});});});})();</script>
      ${ajax('marketing-customselect', "var miss=['service','budget'].filter(function(k){return !f.querySelector('[name='+k+']').value});if(miss.length){miss.forEach(function(k){lhErr(f.querySelector('[data-for='+k+']'),'Please make a selection.')});return;}")}`),
  },
  {
    id: 'realestate-iframe', industry: 'Real estate', note: 'Form embedded in an iframe (form builder style)', mode: 'html', embed: true,
    req: ['name', 'email', 'phone', 'interest', 'message'],
    html: () => layout('Coastal Realty Group', `<p>Fill out the form and an agent will reach out.</p><iframe src="/embed/realestate-iframe" style="width:100%;height:720px;border:0"></iframe>`),
    inner: () => layout('', `<form method="post" action="/submit/realestate-iframe"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="i">I'm interested in *</label><select id="i" name="interest" required>${opts(['Buying', 'Selling', 'Renting', 'Property management'], 'Please select')}</select>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Submit</button></form>`),
  },
  {
    id: 'autorepair-noform', industry: 'Auto repair', note: 'No <form> tag, button with a click handler', mode: 'json',
    req: ['name', 'phone', 'email', 'vehicle', 'issue'],
    html: () => layout('Precision Auto Repair', `<div class="contact-widget">
      <div class="lbl">Name</div><input id="a" name="name">
      <div class="lbl">Phone</div><input id="c" name="phone" type="tel">
      <div class="lbl">Email</div><input id="b" name="email" type="email">
      <div class="lbl">Vehicle (year, make, model)</div><input id="v" name="vehicle">
      <div class="lbl">What's going on with your car?</div><textarea id="i" name="issue"></textarea>
      <button type="button" id="go">Request Appointment</button><div id="out"></div></div>
      <script>document.getElementById('go').onclick=function(){var w=document.querySelector('.contact-widget');var d={};w.querySelectorAll('input,textarea').forEach(function(el){d[el.name]=el.value;});
        if(Object.keys(d).some(function(k){return !d[k]})){document.getElementById('out').innerHTML='<span class="error" role="alert">Please fill in all fields.</span>';return;}
        fetch('/submit/autorepair-noform',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json()}).then(function(j){
          w.innerHTML=j.ok?'<p class="success">Request received! We will call you to confirm your appointment.</p>':'<p class="error">'+j.error+'</p>';});};</script>`),
  },
  {
    id: 'construction-upload', industry: 'General contractor', note: 'Required file upload (PDF or image), multipart post', mode: 'html',
    req: ['name', 'email', 'phone', 'project', 'description'], files: ['plans'],
    html: () => layout('Ironwood Builders', `<form method="post" action="/submit/construction-upload" enctype="multipart/form-data"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="p">Project type *</label><select id="p" name="project" required>${opts(['Remodel', 'Addition', 'New build', 'Commercial'], '-- Select --')}</select>
      <label for="d">Project description *</label><textarea id="d" name="description" required></textarea>
      <label for="u">Upload plans or photos *</label><input id="u" type="file" name="plans" accept=".pdf,.jpg,.jpeg,.png" required>
      <button type="submit">Request Estimate</button></form>`),
  },
  {
    id: 'photography-image', industry: 'Photography', note: 'Hidden image-only upload, radios, date', mode: 'json',
    req: ['name', 'email', 'event_date', 'event_type', 'message'], files: ['reference'], imageOnly: true,
    html: () => layout('Golden Hour Photography', `<style>.up{display:inline-block;border:2px dashed #999;padding:14px;cursor:pointer;position:relative}.up input{position:absolute;inset:0;opacity:0;cursor:pointer}</style>
      <form id="f">
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="d">Event date *</label><input id="d" type="date" name="event_date" required>
      <fieldset><legend>Event type *</legend>${radios('event_type', ['Wedding', 'Portrait', 'Corporate'])}</fieldset>
      <label class="up">Upload a reference photo * <input type="file" name="reference" accept="image/*" required></label>
      <label for="m">Tell us about your vision *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Check Availability</button></form>${ajax('photography-image', "var fi=f.querySelector('[type=file]').files[0];if(!fi||!/^image\\//.test(fi.type)){lhErr(f.querySelector('.up'),'Please upload an image.');return;}if(!f.querySelector('[name=event_type]:checked')){lhErr(f.querySelector('legend'),'Choose an event type.');return;}")}`),
  },
  {
    id: 'chiro-lengths', industry: 'Chiropractor', note: 'maxlength on name/subject, minlength 300 on message', mode: 'html',
    req: ['name', 'email', 'subject', 'message'],
    check: (b) => (b.name.length > 20 ? 'Name too long.' : b.subject.length > 30 ? 'Subject must be 30 characters or less.' : b.message.length < 300 ? 'Message must be at least 300 characters.' : null),
    html: () => layout('Align Chiropractic', `<form method="post" action="/submit/chiro-lengths"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" maxlength="20" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone</label><input id="c" type="tel" name="phone">
      <label for="s">Subject *</label><input id="s" name="subject" maxlength="30" required>
      <label for="m">Message (at least 300 characters) *</label><textarea id="m" name="message" minlength="300" required></textarea>
      <button type="submit">Send</button></form>`),
  },
  {
    id: 'cleaning-confirm-group', industry: 'Cleaning service', note: 'Confirm email + "pick at least one" checkbox group', mode: 'json',
    req: ['name', 'email', 'email_confirm', 'phone', 'services', 'frequency'],
    check: (b) => (b.email !== b.email_confirm ? 'Emails do not match.' : null),
    html: () => layout('Sparkle Clean Co.', `<form id="f">
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="b2">Confirm email *</label><input id="b2" type="email" name="email_confirm" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <fieldset><legend>Services needed *</legend>
        <label class="opt"><input type="checkbox" name="services" value="deep"> Deep clean</label><label class="opt"><input type="checkbox" name="services" value="moveout"> Move-out</label>
        <label class="opt"><input type="checkbox" name="services" value="office"> Office</label><label class="opt"><input type="checkbox" name="services" value="windows"> Windows</label></fieldset>
      <fieldset><legend>How often? *</legend>${radios('frequency', ['One-time', 'Weekly', 'Bi-weekly', 'Monthly'])}</fieldset>
      <label for="m">Anything else?</label><textarea id="m" name="message"></textarea>
      <button>Get a Quote</button></form>${ajax('cleaning-confirm-group', "if(!f.querySelector('[name=services]:checked')){lhErr(f.querySelector('legend'),'Please select at least one service.');return;}if(f.email.value!==f.email_confirm.value){lhErr(f.email_confirm,'Emails do not match.');return;}if(!f.querySelector('[name=frequency]:checked')){lhErr(f.querySelectorAll('legend')[1],'Please choose how often.');return;}")}`),
  },
  {
    id: 'insurance-server-retry', industry: 'Insurance agency', note: 'Server rejects the phone format and re-renders the page', mode: 'html',
    req: ['name', 'email', 'phone', 'coverage', 'message'],
    check: (b) => (!/^\d{3}-\d{3}-\d{4}$/.test(b.phone) ? 'Please enter a valid phone number in the format 555-555-5555.' : null),
    html: () => layout('Shield Insurance Agency', `<form method="post" action="/submit/insurance-server-retry"><!--ERR-->
      <label for="a">Full name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone number *</label><input id="c" type="tel" name="phone" required>
      <label for="v">Coverage type *</label><select id="v" name="coverage" required>${opts(['Auto', 'Home', 'Life', 'Business'], 'Select coverage')}</select>
      <label for="m">Questions or comments *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Get My Quote</button></form>`),
  },
  {
    id: 'solar-range', industry: 'Solar', note: 'Range slider, number with min 0, yes/no select', mode: 'json',
    req: ['name', 'email', 'phone', 'address', 'zip', 'bill', 'roof_age', 'own'],
    check: (b) => (+b.bill < 50 || +b.bill > 500 ? 'Bill out of range.' : +b.roof_age < 0 || +b.roof_age > 50 ? 'Roof age 0-50.' : null),
    html: () => layout('SunPeak Solar', `<form id="f">
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="ad">Street address *</label><input id="ad" name="address" required>
      <label for="z">ZIP *</label><input id="z" name="zip" required>
      <label for="r">Average monthly electric bill *</label><input id="r" type="range" name="bill" min="50" max="500" step="10" value="150">
      <label for="ra">Roof age (years) *</label><input id="ra" type="number" name="roof_age" min="0" max="50" required>
      <label for="o">Do you own your home? *</label><select id="o" name="own" required>${opts(['Yes', 'No'], 'Select')}</select>
      <label for="m">Message</label><textarea id="m" name="message"></textarea>
      <button>See My Savings</button></form>${ajax('solar-range')}`),
  },
  {
    id: 'itservices-inputmsg', industry: 'IT services', note: 'Message is a one-line input, subject is a select', mode: 'html',
    req: ['name', 'email', 'subject', 'message'],
    html: () => layout('ByteGuard IT', `<form method="post" action="/submit/itservices-inputmsg"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="s">Subject *</label><select id="s" name="subject" required>${opts(['General question', 'Support', 'Sales', 'Billing'], 'Choose a subject')}</select>
      <input name="message" placeholder="Your message *" required>
      <button type="submit">Send</button></form>`),
  },
  {
    id: 'medspa-captcha', industry: 'Med spa', note: 'reCAPTCHA: must go to the manual queue', mode: 'html', expect: 'manual',
    req: ['name', 'email', 'message'],
    html: () => layout('Glow Med Spa', `<form method="post" action="/submit/medspa-captcha"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea>
      <div class="g-recaptcha" data-sitekey="6Lc_fake" style="width:304px;height:78px;border:1px solid #ccc"></div>
      <button type="submit">Send</button></form>`),
  },
  {
    id: 'portal-login', industry: 'B2B portal', note: 'Only a login form: must go to the manual queue', mode: 'html', expect: 'manual',
    req: ['email', 'password'],
    html: () => layout('Client Portal', `<form method="post" action="/submit/portal-login"><label for="a">Email</label><input id="a" type="email" name="email" required>
      <label for="b">Password</label><input id="b" type="password" name="password" required><button type="submit">Log in</button></form>`),
  },
  {
    id: 'pest-redirect', industry: 'Pest control', note: 'Post then redirect to a thank-you page', mode: 'redirect',
    req: ['name', 'email', 'phone', 'address', 'pest', 'message'],
    html: () => layout('Guardian Pest Control', `<form method="post" action="/submit/pest-redirect"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="d">Service address *</label><input id="d" name="address" required>
      <label for="p">Pest problem *</label><select id="p" name="pest" required>${opts(['Ants', 'Termites', 'Rodents', 'Bed bugs', 'Other'], 'What are you seeing?')}</select>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Schedule Inspection</button></form>`),
  },
  {
    id: 'catering-multi-forms', industry: 'Catering', note: 'Search and newsletter forms next to the contact form', mode: 'html',
    req: ['name', 'email', 'phone', 'event_date', 'guests', 'message'],
    html: () => layout('Savory Table Catering', `<header><form role="search" action="/search" method="get"><input name="s" placeholder="Search…"><button>Search</button></form></header>
      <h2>Plan your event</h2><form method="post" action="/submit/catering-multi-forms"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="d">Event date *</label><input id="d" name="event_date" placeholder="MM/DD/YYYY" required>
      <label for="g">Guest count *</label><input id="g" type="number" name="guests" min="10" required>
      <label for="m">Tell us about your event *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Request a Quote</button></form>
      <footer><form action="/newsletter" method="post"><label for="nl">Get our seasonal menus</label><input id="nl" type="email" name="email" placeholder="Your email"><button>Subscribe</button></form></footer>`),
  },
  {
    id: 'pool-placeholder', industry: 'Pool service', note: 'No labels at all, placeholders only', mode: 'json',
    req: ['fname', 'lname', 'mail', 'tel', 'pool', 'msg'],
    html: () => layout('Blue Wave Pools', `<form id="f">
      <input name="fname" placeholder="First name" required> <input name="lname" placeholder="Last name" required>
      <input name="mail" type="email" placeholder="Email address" required> <input name="tel" placeholder="Phone" required>
      <select name="pool" required>${opts(['In-ground', 'Above-ground', 'Spa / hot tub'], 'Pool type')}</select>
      <textarea name="msg" placeholder="Tell us about your pool" required></textarea>
      <button>Get a free quote</button></form>${ajax('pool-placeholder')}`),
  },
  {
    id: 'agency-b2b', industry: 'Software agency', note: 'Required company, URL-type website, employee and budget selects', mode: 'html',
    req: ['first_name', 'last_name', 'work_email', 'company', 'website', 'employees', 'budget', 'project'],
    check: (b) => (!/^https?:\/\/[^\s.]+\.[^\s]+/.test(b.website) ? 'Website must be a valid URL.' : null),
    html: () => layout('Pixelcraft Software', `<form method="post" action="/submit/agency-b2b"><!--ERR-->
      <label for="a">First name *</label><input id="a" name="first_name" required>
      <label for="b">Last name *</label><input id="b" name="last_name" required>
      <label for="c">Work email *</label><input id="c" type="email" name="work_email" required>
      <label for="d">Company *</label><input id="d" name="company" required>
      <label for="w">Company website *</label><input id="w" type="url" name="website" required>
      <label for="e">Number of employees *</label><select id="e" name="employees" required>${opts(['1-10', '11-50', '51-200', '200+'], 'Select')}</select>
      <label for="g">Project budget *</label><select id="g" name="budget" required>${opts(['$10k–$25k', '$25k–$50k', '$50k–$100k', '$100k+'], 'Select')}</select>
      <label for="p">Project details *</label><textarea id="p" name="project" required></textarea>
      <button type="submit">Start a Project</button></form>`),
  },
  {
    id: 'gym-radiocards', industry: 'Gym', note: 'Visually hidden radios and a custom SMS consent checkbox', mode: 'json',
    req: ['name', 'email', 'phone', 'membership', 'best_time', 'sms_consent'],
    html: () => layout('Forge Fitness', `<style>.card{display:inline-block;border:2px solid #ccc;border-radius:8px;padding:14px;margin:4px;position:relative;cursor:pointer}.card input{position:absolute;opacity:0;width:1px;height:1px}
      .card:has(input:checked){border-color:#e60}.chk{position:relative;padding-left:28px;display:block;cursor:pointer}.chk input{position:absolute;opacity:0;left:0}.chk span.box{position:absolute;left:0;top:0;width:18px;height:18px;border:2px solid #555}</style>
      <form id="f">
      <label for="a">Name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Mobile phone *</label><input id="c" type="tel" name="phone" required>
      <p>Membership interest *</p><div><label class="card"><input type="radio" name="membership" value="basic" required>Basic</label><label class="card"><input type="radio" name="membership" value="premium">Premium</label><label class="card"><input type="radio" name="membership" value="pt">Personal training</label></div>
      <p>Best time to reach you *</p><div><label class="card"><input type="radio" name="best_time" value="morning" required>Morning</label><label class="card"><input type="radio" name="best_time" value="afternoon">Afternoon</label><label class="card"><input type="radio" name="best_time" value="evening">Evening</label></div>
      <label class="chk"><input type="checkbox" name="sms_consent" value="1" required><span class="box"></span>I agree to receive text messages about my membership *</label>
      <button>Claim Free Pass</button></form>${ajax('gym-radiocards')}`),
  },
  {
    id: 'vet-address', industry: 'Veterinary', note: 'State select with full names, country select, how-heard', mode: 'html',
    req: ['name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country', 'heard', 'pet', 'message'],
    html: () => layout('Happy Paws Animal Hospital', `<form method="post" action="/submit/vet-address"><!--ERR-->
      <label for="a">Owner name *</label><input id="a" name="name" required>
      <label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="c">Phone *</label><input id="c" type="tel" name="phone" required>
      <label for="ad">Address *</label><input id="ad" name="address" required>
      <label for="ci">City *</label><input id="ci" name="city" required>
      <label for="st">State *</label><select id="st" name="state" required>${opts([['AZ', 'Arizona'], ['CA', 'California'], ['NY', 'New York'], ['TX', 'Texas'], ['WA', 'Washington']], 'Select state')}</select>
      <label for="z">ZIP *</label><input id="z" name="zip" required>
      <label for="co">Country *</label><select id="co" name="country" required>${opts([['CA', 'Canada'], ['US', 'United States'], ['MX', 'Mexico']], 'Select country')}</select>
      <label for="h">How did you hear about us? *</label><select id="h" name="heard" required>${opts(['Friend or family', 'Google search', 'Facebook', 'Drove by'], '- Select -')}</select>
      <fieldset><legend>Pet type *</legend><label class="opt"><input type="radio" name="pet" value="Dog" required> Dog</label><label class="opt"><input type="radio" name="pet" value="Cat"> Cat</label><label class="opt"><input type="radio" name="pet" value="Other"> Other</label></fieldset>
      <label for="m">Reason for visit *</label><textarea id="m" name="message" required></textarea>
      <button type="submit">Request Appointment</button></form>`),
  },
  {
    id: 'electrician-gravity', industry: 'Electrician', note: 'Gravity-style: labels not linked to inputs, server-side required', mode: 'html',
    req: ['input_1', 'input_2', 'input_3', 'input_4', 'input_5', 'input_6'],
    check: (b) => (!isEmail(b.input_2) ? 'Email: please enter a valid email address.' : null),
    html: () => layout('Volt Electric', `<form method="post" action="/submit/electrician-gravity" class="gform" novalidate><!--ERR-->
      <div class="gfield"><div class="lbl">Name <span class="gfield_required">*</span></div><div class="ginput"><input name="input_1"></div></div>
      <div class="gfield"><div class="lbl">Email <span class="gfield_required">*</span></div><div class="ginput"><input name="input_2"></div></div>
      <div class="gfield"><div class="lbl">Phone <span class="gfield_required">*</span></div><div class="ginput"><input name="input_3"></div></div>
      <div class="gfield"><div class="lbl">Service address <span class="gfield_required">*</span></div><div class="ginput"><input name="input_4"></div></div>
      <div class="gfield"><div class="lbl">Type of work <span class="gfield_required">*</span></div><div class="ginput"><select name="input_5">${opts(['Panel upgrade', 'Wiring', 'Lighting', 'EV charger', 'Other'], 'Select one')}</select></div></div>
      <div class="gfield"><div class="lbl">Describe the job <span class="gfield_required">*</span></div><div class="ginput"><textarea name="input_6"></textarea></div></div>
      <input type="submit" value="Submit" class="gform_button"></form>`),
  },
  {
    id: 'directory-signup', industry: 'Directory page', note: 'Houzz-style profile: only a signup form, no contact form. Must not be filled.', mode: 'html', expect: 'noform',
    req: ['email'],
    html: () => layout('Pro profile on a directory', `<p>Great decks, 5 stars. Join to message this pro.</p><form method="post" action="/submit/directory-signup"><!--ERR-->
      <label for="a">First name</label><input id="a" name="first_name"><label for="b">Email</label><input id="b" type="email" name="email" required>
      <label for="z">ZIP code</label><input id="z" name="zip"><button type="submit">Sign Up</button></form>`),
  },
  {
    id: 'late-captcha', industry: 'Painter', note: 'reCAPTCHA appears only after you start typing. Must go to the manual queue.', mode: 'html', expect: 'manual',
    req: ['name', 'email', 'message'],
    html: () => layout('Brush & Roll Painting', `<form method="post" action="/submit/late-captcha"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea><div id="cap"></div><button type="submit">Send</button></form>
      <script>document.addEventListener('focusin',function f(){document.removeEventListener('focusin',f);var d=document.createElement('div');d.className='g-recaptcha';d.setAttribute('data-sitekey','x');d.style.cssText='width:304px;height:78px;border:1px solid #ccc';document.getElementById('cap').appendChild(d);});</script>`),
  },
  {
    id: 'silent-reset', industry: 'Locksmith', note: 'AJAX form that just clears itself after a successful send, no message.', mode: 'html',
    req: ['name', 'email', 'phone', 'message'],
    html: () => layout('KeyFast Locksmith', `<form id="f"><label for="a">Name</label><input id="a" name="name" required><label for="b">Email</label><input id="b" type="email" name="email" required>
      <label for="c">Phone</label><input id="c" type="tel" name="phone" required><label for="m">Message</label><textarea id="m" name="message" required></textarea><button>Send</button></form>
      <script>var f=document.getElementById('f');f.addEventListener('submit',function(e){e.preventDefault();fetch('/submit/silent-reset',{method:'POST',body:new FormData(f)}).then(function(r){if(r.ok)f.reset();});});</script>`),
  },
  {
    id: 'masked-phone', industry: 'Remodeling', note: 'Phone input mask that only accepts real typing (ignores values set by script)', mode: 'json',
    req: ['name', 'email', 'phone', 'message'],
    check: (b) => (!/^\(\d{3}\) \d{3}-\d{4}$/.test(b.phone) ? 'Enter a full phone number.' : null),
    html: () => layout('SRT Building & Renovation', `<form id="f"><input name="name" placeholder="Name" required><input name="phone" id="ph" placeholder="Phone number" required>
      <input name="email" type="email" placeholder="Email" required><textarea name="message" placeholder="Message" required></textarea><button>Send Message</button></form>
      <script>(function(){var el=document.getElementById('ph'),d='';function fmt(x){if(!x)return '';var a=x.slice(0,3),b=x.slice(3,6),c=x.slice(6,10);return '('+a+(x.length>3?') '+b:'')+(x.length>6?'-'+c:'');}
        el.addEventListener('beforeinput',function(e){e.preventDefault();if(e.inputType==='insertText'&&e.data){d=(d+e.data.replace(/\D/g,'')).slice(0,10);}else if(/delete/.test(e.inputType)){d=el.selectionStart===0&&el.selectionEnd===el.value.length?'':d.slice(0,-1);}el.value=fmt(d);});
        el.addEventListener('input',function(){el.value=fmt(d);});})();</script>${ajax('masked-phone')}`),
  },
  {
    id: 'invisible-captcha', industry: 'Builder', note: 'Only an invisible reCAPTCHA badge: nothing to solve, so the robot sends it', mode: 'html',
    req: ['name', 'email', 'message'],
    html: () => layout('Invisible Check Builders', `<form method="post" action="/submit/invisible-captcha"><!--ERR--><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required>
      <textarea name="message" placeholder="Message" required></textarea><button type="submit">Send</button></form>
      <div class="grecaptcha-badge" style="position:fixed;right:0;bottom:14px;width:256px;height:60px"><iframe title="reCAPTCHA" src="about:blank#recaptcha-anchor?size=invisible" style="width:256px;height:60px;border:0"></iframe></div>`),
  },
  {
    id: 'wpforms-real', industry: 'Remodeling', note: 'Real WPForms markup (srtbuilding.com): number-type phone, two honeypots, invisible reCAPTCHA v3 on the page', mode: 'redirect',
    req: ['wpforms[fields][0]', 'wpforms[fields][4]', 'wpforms[fields][3]', 'wpforms[fields][1]', 'wpforms[fields][2]'], traps: ['wpforms[fields][5]', 'wpforms[fields][6]'],
    check: (b) => (!/^\d{10}$/.test(b['wpforms[fields][4]']) ? 'Phone must be digits.' : null),
    html: () => layout('SRT Building & Renovation', `<script src="https://www.google.com/recaptcha/api.js?render=6LcFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"></script>
      <section class="widget wpforms-widget"><h2>REQUEST A FREE CONSULTATION</h2><form id="wpforms-form-19" class="wpforms-validate wpforms-form" method="post" action="/submit/wpforms-real" novalidate><!--ERR-->
      <div class="wpforms-field"><label class="wpforms-label-hide" for="f0" style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">Name <span>*</span></label><input type="text" id="f0" name="wpforms[fields][0]" placeholder="Full name" required></div>
      <div class="wpforms-field"><label class="wpforms-label-hide" for="f4" style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">Number <span>*</span></label><input type="number" id="f4" name="wpforms[fields][4]" placeholder="Phone number " step="any" required></div>
      <div class="wpforms-field"><label class="wpforms-label-hide" for="f3" style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">When are you ready to start? <span>*</span></label><input type="text" id="f3" name="wpforms[fields][3]" placeholder="When are you ready to start?" required></div>
      <div class="wpforms-field"><label for="f5" aria-hidden="true">you Number Email</label><input type="text" id="f5" name="wpforms[fields][5]" tabindex="-1" aria-hidden="true"></div>
      <div class="wpforms-field" style="position:absolute!important;overflow:hidden!important;display:inline!important;height:1px!important;width:1px!important;z-index:-1000!important;padding:0!important"><label for="f6" aria-hidden="true"></label><input type="text" id="f6" name="wpforms[fields][6]" aria-hidden="true" style="visibility:hidden" tabindex="-1"></div>
      <div class="wpforms-field"><label class="wpforms-label-hide" for="f1" style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">Email <span>*</span></label><input type="email" id="f1" name="wpforms[fields][1]" placeholder="Email address" required></div>
      <div class="wpforms-field"><label class="wpforms-label-hide" for="f2" style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">Project Description <span>*</span></label><textarea id="f2" name="wpforms[fields][2]" placeholder="Project description" required></textarea></div>
      <button type="submit" class="wpforms-submit">Send Message</button></form></section><div class="grecaptcha-badge" style="position:fixed;right:0;bottom:14px;width:256px;height:60px"></div>`),
  },
];

// Copies of the most common form tools' real markup (Phase 2: more realistic coverage).
const okScript = (id, sel, success) => `<script>(function(){var f=document.querySelector('${sel}');
f.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(f);
fetch('/submit/${id}',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){${success}});});})();</script>`;
FIXTURES.push(
  {
    id: 'elementor-pro', industry: 'Roofing', note: 'Elementor Pro form: bracketed names, AJAX, success message in place', mode: 'json',
    req: ['form_fields[name]', 'form_fields[email]', 'form_fields[message]'],
    html: () => layout('Summit Roofing Co', `<form class="elementor-form" method="post" name="Contact" id="ef">
      <input type="hidden" name="post_id" value="12"><input type="hidden" name="form_id" value="a1b2c3">
      <div class="elementor-form-fields-wrapper">
      <div class="elementor-field-group elementor-field-type-text elementor-field-required"><label for="form-field-name" class="elementor-field-label">Name</label><input type="text" name="form_fields[name]" id="form-field-name" class="elementor-field" placeholder="Name" required aria-required="true"></div>
      <div class="elementor-field-group elementor-field-type-email elementor-field-required"><label for="form-field-email" class="elementor-field-label">Email</label><input type="email" name="form_fields[email]" id="form-field-email" class="elementor-field" placeholder="Email" required aria-required="true"></div>
      <div class="elementor-field-group elementor-field-type-tel"><label for="form-field-phone" class="elementor-field-label">Phone</label><input type="tel" name="form_fields[phone]" id="form-field-phone" class="elementor-field" placeholder="Phone"></div>
      <div class="elementor-field-group elementor-field-type-textarea elementor-field-required"><label for="form-field-message" class="elementor-field-label">Message</label><textarea name="form_fields[message]" id="form-field-message" class="elementor-field" rows="4" placeholder="Message" required aria-required="true"></textarea></div>
      <div class="elementor-field-group elementor-field-type-submit"><button type="submit" class="elementor-button"><span><span class="elementor-button-text">Send</span></span></button></div></div></form>
      ${okScript('elementor-pro', '#ef', "var m=document.createElement('div');m.className=j.ok?'elementor-message elementor-message-success':'elementor-message elementor-message-danger';m.setAttribute('role','alert');m.textContent=j.ok?'Your submission was successful.':j.error;f.appendChild(m);if(j.ok)f.reset();")}`),
  },
  {
    id: 'hubspot-embed', industry: 'Accounting', note: 'HubSpot form in an iframe: split names, hs-button, form replaced by a thank-you', mode: 'json', embed: true,
    req: ['firstname', 'lastname', 'email', 'message'],
    html: () => layout('Ledger & Co CPAs', `<p>Book a free consultation.</p><iframe class="hs-form-iframe" src="/embed/hubspot-embed" style="width:100%;height:640px;border:0"></iframe>`),
    inner: () => layout('', `<form class="hs-form stacked hs-custom-form" id="hsf" novalidate>
      <div class="hs_firstname hs-form-field"><label for="firstname-9f2"><span>First name</span><span class="hs-form-required">*</span></label><div class="input"><input id="firstname-9f2" name="firstname" class="hs-input" required></div></div>
      <div class="hs_lastname hs-form-field"><label for="lastname-9f2"><span>Last name</span><span class="hs-form-required">*</span></label><div class="input"><input id="lastname-9f2" name="lastname" class="hs-input" required></div></div>
      <div class="hs_email hs-form-field"><label for="email-9f2"><span>Email</span><span class="hs-form-required">*</span></label><div class="input"><input id="email-9f2" name="email" type="email" class="hs-input" required></div></div>
      <div class="hs_company hs-form-field"><label for="company-9f2"><span>Company name</span></label><div class="input"><input id="company-9f2" name="company" class="hs-input"></div></div>
      <div class="hs_message hs-form-field"><label for="message-9f2"><span>How can we help?</span><span class="hs-form-required">*</span></label><div class="input"><textarea id="message-9f2" name="message" class="hs-input" required></textarea></div></div>
      <div class="hs_submit hs-submit"><div class="actions"><input type="submit" class="hs-button primary large" value="Submit"></div></div></form>
      ${okScript('hubspot-embed', '#hsf', "if(j.ok){var d=document.createElement('div');d.className='submitted-message';d.textContent='Thanks for submitting the form.';f.replaceWith(d);}else{var e=document.createElement('ul');e.className='hs-error-msgs';e.setAttribute('role','alert');e.textContent=j.error;f.appendChild(e);}")}`),
  },
  {
    id: 'jotform-embed', industry: 'Landscaping', note: 'Jotform in an iframe: compound field names, classic post to a thank-you page', mode: 'redirect', embed: true,
    req: ['q3_name[first]', 'q3_name[last]', 'q4_email', 'q6_message'],
    html: () => layout('Green Acres Landscaping', `<iframe id="JotFormIFrame-2312" title="Contact Form" src="/embed/jotform-embed" style="width:100%;height:760px;border:none"></iframe>`),
    inner: () => layout('', `<form class="jotform-form" action="/submit/jotform-embed" method="post" name="form_2312" id="2312"><!--ERR-->
      <ul class="form-section"><li class="form-line jf-required" id="id_3"><label class="form-label form-label-top" id="label_3">Name<span class="form-required">*</span></label>
        <div class="form-input-wide"><span class="form-sub-label-container"><input type="text" id="first_3" name="q3_name[first]" class="form-textbox validate[required]" aria-labelledby="label_3 sublabel_3_first" required><label class="form-sub-label" for="first_3" id="sublabel_3_first">First Name</label></span>
        <span class="form-sub-label-container"><input type="text" id="last_3" name="q3_name[last]" class="form-textbox validate[required]" aria-labelledby="label_3 sublabel_3_last" required><label class="form-sub-label" for="last_3" id="sublabel_3_last">Last Name</label></span></div></li>
      <li class="form-line jf-required" id="id_4"><label class="form-label form-label-top" id="label_4" for="input_4">E-mail<span class="form-required">*</span></label><div class="form-input-wide"><input type="email" id="input_4" name="q4_email" class="form-textbox validate[required, Email]" required></div></li>
      <li class="form-line" id="id_5"><label class="form-label form-label-top" id="label_5" for="input_5_full">Phone Number</label><div class="form-input-wide"><input type="tel" id="input_5_full" name="q5_phoneNumber[full]" class="form-textbox" placeholder="(000) 000-0000"></div></li>
      <li class="form-line jf-required" id="id_6"><label class="form-label form-label-top" id="label_6" for="input_6">Tell us about your project<span class="form-required">*</span></label><div class="form-input-wide"><textarea id="input_6" name="q6_message" class="form-textarea validate[required]" required></textarea></div></li>
      <li class="form-line" id="id_2"><div class="form-input-wide"><button id="input_2" type="submit" class="form-submit-button submit-button jf-form-buttons">Submit</button></div></li></ul></form>`),
  },
  {
    id: 'squarespace-form', industry: 'Photography', note: 'Squarespace form: name fieldset with first/last, form replaced by thank-you text', mode: 'json',
    req: ['fname', 'lname', 'email', 'message'],
    html: () => layout('Lumen Studio', `<div class="form-wrapper"><div class="form-inner-wrapper"><form class="react-form-contents" id="sqf" novalidate>
      <fieldset class="form-item fields name required"><legend class="title">Name <span class="required">*</span></legend>
        <div class="field first-name"><label class="caption" for="fname-yui"><input id="fname-yui" class="field-element field-control" name="fname" type="text" spellcheck="false" maxlength="30" data-title="First" aria-required="true"><span class="caption-text">First Name</span></label></div>
        <div class="field last-name"><label class="caption" for="lname-yui"><input id="lname-yui" class="field-element field-control" name="lname" type="text" spellcheck="false" maxlength="30" data-title="Last" aria-required="true"><span class="caption-text">Last Name</span></label></div></fieldset>
      <div class="form-item field email required"><label class="title" for="email-yui">Email <span class="required">*</span></label><input class="field-element" name="email" type="email" id="email-yui" autocomplete="false" spellcheck="false" aria-required="true"></div>
      <div class="form-item field textarea required"><label class="title" for="textarea-yui">Message <span class="required">*</span></label><textarea class="field-element" id="textarea-yui" name="message" aria-required="true"></textarea></div>
      <div class="form-button-wrapper form-button-wrapper--align-left"><button class="button sqs-system-button sqs-editable-button sqs-button-element--primary" type="submit">Submit</button></div></form>
      <div class="form-submission-text hidden" style="display:none">Thank you!</div></div></div>
      ${okScript('squarespace-form', '#sqf', "if(j.ok){f.style.display='none';var t=document.querySelector('.form-submission-text');t.style.display='block';t.classList.remove('hidden');}else{var e=document.createElement('div');e.className='form-item error';e.setAttribute('role','alert');e.textContent=j.error;f.prepend(e);}")}`),
  },
  {
    id: 'wix-form', industry: 'Salon', note: 'Wix form: no form tag, button without a submit type, inline thank-you', mode: 'json',
    req: ['first-name', 'email', 'message'],
    html: () => layout('Velvet Hair Studio', `<div id="comp-kx1" class="wixui-form" data-testid="richTextElement">
      <div class="field"><label for="input_comp-a1" class="wixui-text-input__label">First Name *</label><input id="input_comp-a1" name="first-name" class="has-custom-focus wixui-text-input__input" type="text" aria-required="true" required></div>
      <div class="field"><label for="input_comp-a2" class="wixui-text-input__label">Email *</label><input id="input_comp-a2" name="email" class="has-custom-focus wixui-text-input__input" type="email" aria-required="true" required></div>
      <div class="field"><label for="textarea_comp-a3" class="wixui-text-box__label">Message *</label><textarea id="textarea_comp-a3" name="message" class="wixui-text-box__input" aria-required="true" required></textarea></div>
      <div data-testid="buttonElement-wrapper"><button data-testid="buttonElement" class="wixui-button" aria-disabled="false"><span class="wixui-button__label">Submit</span></button></div>
      <p id="wix-thanks" class="wixui-rich-text" style="display:none">Thanks for submitting!</p></div>
      <script>(function(){var b=document.querySelector('[data-testid=buttonElement]');b.addEventListener('click',function(){var fd=new FormData();
      document.querySelectorAll('#comp-kx1 input, #comp-kx1 textarea').forEach(function(x){fd.append(x.name,x.value)});
      fetch('/submit/wix-form',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){if(j.ok){document.getElementById('wix-thanks').style.display='block';document.querySelectorAll('#comp-kx1 input, #comp-kx1 textarea').forEach(function(x){x.value=''});}
      else{var e=document.createElement('p');e.setAttribute('role','alert');e.className='error';e.textContent=j.error;b.parentNode.appendChild(e);}});});})();</script>`),
  },
  {
    id: 'slow-server', industry: 'HVAC', note: 'Classic post to a backend that takes 7 s to answer: must be sent once, never twice', mode: 'redirect', delay: 7000,
    req: ['name', 'email', 'message'],
    html: () => layout('Polar Air Heating & Cooling', `<form method="post" action="/submit/slow-server"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea><button type="submit">Send request</button></form>`),
  },
  {
    id: 'busy-network', industry: 'Cleaning', note: 'Analytics pings every 400 ms, so the network never goes quiet: the engine must not wait for silence', mode: 'html',
    req: ['name', 'email', 'message'],
    html: () => layout('Sparkle Home Cleaning', `<form method="post" action="/submit/busy-network"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea><button type="submit">Send</button></form>
      <script>setInterval(function(){fetch('/beacon?'+Date.now()).catch(function(){})},400);</script>`),
  },
  {
    id: 'js-captcha-late', industry: 'Plumbing', note: 'A script adds a visible reCAPTCHA 1.8 s after the form appears. Must go to the manual queue.', mode: 'html', expect: 'manual',
    req: ['name', 'email', 'message'],
    html: () => layout('FlowRight Plumbing', `<form method="post" action="/submit/js-captcha-late"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea><div id="cap"></div><button type="submit">Send</button></form>
      <script>setTimeout(function(){var d=document.createElement('div');d.className='g-recaptcha';d.setAttribute('data-sitekey','x');d.style.cssText='width:304px;height:78px;border:1px solid #ccc';var f=document.createElement('iframe');f.title='reCAPTCHA';f.src='about:blank';f.style.cssText='width:304px;height:78px;border:0';d.appendChild(f);document.getElementById('cap').appendChild(d);},1800);</script>`),
  },
  {
    id: 'no-solicitation', industry: 'Law firm', note: 'The page says "No solicitations, please." above the form: must be skipped, never sent', mode: 'html', expect: 'skipped',
    req: ['name', 'email', 'message'],
    html: () => layout('Hart & Lowe Attorneys', `<p><strong>No solicitations, please.</strong> This form is for prospective clients only.</p><form method="post" action="/submit/no-solicitation"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">How can we help? *</label><textarea id="m" name="message" required></textarea><button type="submit">Send</button></form>`),
  },
  {
    id: 'popup-quote', industry: 'Roofing', note: 'Form hidden in a pop-up behind a "Get a Free Quote" button: the robot must open it and send', mode: 'json',
    req: ['name', 'email', 'message'],
    html: () => layout('Lone Star Roofing', `<p>Storm damage? We can help.</p><button type="button" id="open" class="btn-quote">Get a Free Quote</button>
      <div id="modal" style="display:none;position:fixed;inset:10% 20%;background:#fff;border:1px solid #ccc;padding:20px"><form id="f">
        <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
        <label for="m">Project details *</label><textarea id="m" name="message" required></textarea><button type="submit">Request quote</button></form></div>
      <script>document.getElementById('open').onclick=function(){document.getElementById('modal').style.display='block';};</script>${ajax('popup-quote')}`),
  },
  {
    id: 'hidden-dead-form', industry: 'Roofing', note: 'A form exists in the page code but is permanently hidden (unused theme leftover): no usable form', mode: 'html', expect: 'noform',
    req: ['name', 'email', 'message'],
    html: () => layout('Summit Roof Pros', `<p>Call us at (512) 555-0101 for a free inspection.</p><div style="display:none"><form method="post" action="/submit/hidden-dead-form"><!--ERR-->
      <input name="name"><input type="email" name="email"><textarea name="message"></textarea><button type="submit">Send</button></form></div>`),
  },
  {
    id: 'contact-subpage', industry: 'Roofing', note: 'No form on the home page; the Contact Us page has one (the website check must find it)', mode: 'html', expect: 'noform', embed: true,
    req: ['name', 'email', 'message'],
    html: () => layout('Ridgeline Roofing', `<p>Family owned. <a href="/embed/contact-subpage">Contact Us</a></p>`),
    inner: () => layout('Contact Ridgeline Roofing', `<form method="post" action="/submit/contact-subpage"><!--ERR-->
      <label for="a">Name *</label><input id="a" name="name" required><label for="b">Email *</label><input id="b" type="email" name="email" required>
      <label for="m">Message *</label><textarea id="m" name="message" required></textarea><button type="submit">Send</button></form>`),
  },
  {
    id: 'ninja-forms', industry: 'Pest control', note: 'Ninja Forms: generic field names, submit is type=button, success message replaces fields', mode: 'json',
    req: ['nf-field-1', 'nf-field-2', 'nf-field-3'],
    html: () => layout('BugOut Pest Control', `<div class="nf-form-cont"><div class="nf-form-layout"><form id="nf" novalidate><div class="nf-form-content">
      <div class="nf-field-container textbox-container label-above"><div class="nf-field-label"><label for="nf-field-1" id="nf-label-field-1">Name <span class="ninja-forms-req-symbol">*</span></label></div><div class="nf-field-element"><input type="text" id="nf-field-1" name="nf-field-1" class="ninja-forms-field nf-element" aria-required="true"></div></div>
      <div class="nf-field-container email-container label-above"><div class="nf-field-label"><label for="nf-field-2" id="nf-label-field-2">Email <span class="ninja-forms-req-symbol">*</span></label></div><div class="nf-field-element"><input type="email" id="nf-field-2" name="nf-field-2" class="ninja-forms-field nf-element" aria-required="true"></div></div>
      <div class="nf-field-container textarea-container label-above"><div class="nf-field-label"><label for="nf-field-3" id="nf-label-field-3">Message <span class="ninja-forms-req-symbol">*</span></label></div><div class="nf-field-element"><textarea id="nf-field-3" name="nf-field-3" class="ninja-forms-field nf-element" aria-required="true"></textarea></div></div>
      <div class="nf-field-container submit-container"><div class="nf-field-element"><input id="nf-field-4" class="ninja-forms-field nf-element" type="button" value="Submit"></div></div></div></form>
      <div class="nf-response-msg"></div></div></div>
      <script>(function(){var f=document.getElementById('nf');document.getElementById('nf-field-4').addEventListener('click',function(){
      fetch('/submit/ninja-forms',{method:'POST',body:new FormData(f)}).then(function(r){return r.json()}).then(function(j){var m=document.querySelector('.nf-response-msg');
      if(j.ok){f.style.display='none';m.innerHTML='<p>Your form has been successfully submitted.</p>';}else{m.innerHTML='<p class="nf-error-msg" role="alert">'+j.error+'</p>';}});});})();</script>`),
  },
);

export const byId = Object.fromEntries(FIXTURES.map(f => [f.id, f]));
export { isEmail, today };
