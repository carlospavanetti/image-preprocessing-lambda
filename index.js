var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true });
var s3 = new AWS.S3();

var SIZES = ["800x600", "400x300"];

exports.handler = function(event, context) {
    var message, srcKey, dstKey, srcBucket, dstBucket, filename;
    message = JSON.parse(event.Records[0].Sns.Message).Records[0];

    srcBucket = message.s3.bucket.name;
    dstBucket = srcBucket;
    srcKey    =  withoutWhitespaceReplacement(message.s3.object.key);
    filename  = srcKey.split("/")[1];
    dstKey    = ""; // WIDTHxHEIGHT/filename

    // Infer the image type
    var extension = fileExtension(srcKey);
    if (isNotPresent(extension, srcKey)) return context.done();
    if (isNotValid(extension, srcKey)) return context.done();

    // Download the image from S3
    s3.getObject({
            Bucket: srcBucket,
            Key: srcKey
    }, function(err, response){
        if (err){
            var err_message = 'Cannot download image: ' + srcKey + " - " + err;
            return console.error(err_message);
        }

        var contentType = response.ContentType;

        // Pass in our image to ImageMagick
        var original = gm(response.Body);

        // Obtain the size of the image
        original.size(function(err, size){
            if(err){
                return console.error(err);
            }

            // For each SIZES, call the resize function
            async.each(SIZES, function (width_height,  callback) {
                var filename = srcKey.split("/")[1];
                var thumbDstKey = width_height +"/" + filename;
                resize(size, width_height, imageType, original, srcKey, dstBucket, thumbDstKey, contentType, callback);
            },
            function (err) {
                if (err) {
                    var err_message = 'Cannot resize ' + srcKey + 'error: ' + err;
                    console.error(err_message);
                }
                context.done();
            });
        });
    });
};

var resize = function(size, width_height, imageType, original, srcKey, dstBucket, dstKey, contentType) {
    async.waterfall([
        function transform(next) {
            var width_height_values = width_height.split("x");
            var width  = width_height_values[0];
            var height = width_height_values[1];

            // Transform the image buffer in memory
            original.interlace("Plane")
                .quality(80)
                .resize(width, height, '^')
                .gravity('Center')
                .crop(width, height)
                .toBuffer(imageType, function(err, buffer) {
                if (err) {
                    next(err);
                } else {
                    next(null, buffer);
                }
            });
        },
        function upload(data, next) {
            console.log("Uploading data to " + dstKey);
            s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: contentType,
                    ACL: 'public-read'
                },
                next);
            }
        ], function (err) {
            if (err) {
                console.error(err);
            }
        }
    );
};

function withoutWhitespaceReplacement(location) {
    return location.replace(/\+/g, " ");
}

function fileExtension(location) {
    try {
        return location.match(/\.([^.]*)$/)[1].toLowerCase();
    } catch {
        return null;
    }
}

function isNotPresent(extension, location) {
    if (!extension) {
        console.error('Unable to infer image type for ' + location);
        return true;
    }
}

function isNotValid(extension, location) {   
    if (!["jpg", "jpeg", "png"].includes(extension)) {
        var err_message = 'Skipping non-image ' + location;
        console.log('Skipping non-image ' + location);
        return true;
    }
}
