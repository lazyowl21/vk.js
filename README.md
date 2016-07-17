# vk.js
Simple implementation of VK API in Node.js. 

## API Requests

There is simple interface to perform requests to VK API. 

    var vk = require("vk.js");
    var req = vk.Request( method, method_options );
    
Parameters:
 + method \[string\] 
 + method_options \[object\]\(optional\)

Returns:
 + Promise object.

### Example
    
     var vk = require("vk.js");
     vk.Request("users.get",{user_ids:[1]})
        .then( data => {
            // [ { uid: 1, first_name: 'Павел', last_name: 'Дуров' } ]
            // data processing
        });

[Authorization Code Flow](https://new.vk.com/dev/authcode_flow_user) and [Client Credentials Flow](https://new.vk.com/dev/client_cred_flow)  
