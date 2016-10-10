"use strict";

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
        Schema = mongoose.Schema,
        timestamps = require('mongoose-timestamp');

var DataTable = require('mongoose-datatable');

DataTable.configure({
    verbose: false,
    debug: false
});
mongoose.plugin(DataTable.init);

var Dict = INCLUDE('dict');

var setPrice = function (value) {
    return MODULE('utils').setPrice(value);
};

/**
 * Article Schema
 */
var billSchema = new Schema({
    ref: {type: String, unique: true},
    type: {type: String, default: 'INVOICE_STANDARD'},
    title: {//For internal use only
        ref: String,
        autoGenerated: {type: Boolean, default: false} //For automatic process generated bills
    },
    Status: {type: String, default: 'DRAFT'},
    cond_reglement_code: {type: String, default: '30D'},
    mode_reglement_code: {type: String, default: 'CHQ'},
    //bank_reglement: {type: String},
    client: {
        id: {type: Schema.Types.ObjectId, ref: 'societe'},
        name: String,
        isNameModified: {type: Boolean}
    },
    /*contact: {
     id: {
     type: Schema.Types.ObjectId,
     ref: 'contact'
     },
     name: {type: String, default: ""},
     phone: String,
     email: String
     },*/
    contacts: [{
            type: Schema.Types.ObjectId,
            ref: 'contact'
        }],
    ref_client: {type: String, default: ""},
    imported: {type: Boolean, default: false}, //imported in accounting
    journalId: [Schema.Types.ObjectId], // Id transactions for accounting
    price_level: {type: String, default: "BASE", uppercase: true, trim: true},
    address: {type: String, default: ""},
    zip: {type: String, default: ""},
    town: {type: String, default: ""},
    country_id: {type: String, default: 'FR'},
    state_id: Number,
    datec: {type: Date, default: new Date},
    dater: {type: Date}, // date limit reglement
    dateOf: {type: Date}, // Periode de facturation du
    dateTo: {type: Date}, // au
    notes: [{
            title: String,
            note: String,
            public: {
                type: Boolean,
                default: false
            },
            edit: {
                type: Boolean,
                default: false
            }
        }],
    discount: {
        percent: {type: Number, default: 0},
        value: {type: Number, default: 0, set: setPrice} // total remise globale
    },
    total_ht: {type: Number, default: 0, set: setPrice},
    total_tva: [
        {
            tva_tx: Number,
            total: {type: Number, default: 0}
        }
    ],
    total_ttc: {type: Number, default: 0, set: setPrice},
    total_paid: {type: Number, default: 0, set: setPrice},
    shipping: {
        total_ht: {type: Number, default: 0, set: setPrice},
        tva_tx: {type: Number, default: 20},
        total_tva: {type: Number, default: 0}
    },
    author: {id: String, name: String},
    commercial_id: {id: {type: String}, name: String},
    entity: {type: String},
    modelpdf: String,
    orders: [{type: Schema.Types.ObjectId, ref: 'order'}],
    deliveries: [{type: Schema.Types.ObjectId, ref: 'delivery'}],
    groups: [Schema.Types.Mixed],
    lines: [{
            //pu: Number,
            qty: Number,
            tva_tx: Number,
            group: {type: String, default: "1. DEFAULT"},
            //title: String,
            priceSpecific: {type: Boolean, default: false},
            pu_ht: Number,
            description: {type: String, default: ""},
            product_type: String,
            product: {
                id: {type: Schema.Types.ObjectId, ref: "Product"},
                name: {type: String},
                label: String,
                template: {type: String, default: "/partials/lines/classic.html"}
                //family: String
            },
            total_tva: Number,
            total_ttc: Number,
            discount: {type: Number, default: 0},
            no_package: Number, // Colis Number
            total_ht: {type: Number, set: setPrice},
            date_start: Date,
            date_end: Date
        }],
    history: [{
            date: {type: Date, default: Date.now},
            author: {
                id: String,
                name: String
            },
            mode: String, //email, order, alert, new, ...
            Status: String,
            msg: String
        }],
    feeBilling: {type: Boolean, default: true}, // Frais de facturation
    oldId: String // Only for import migration
}, {
    toObject: {virtuals: true},
    toJSON: {virtuals: true}
});

billSchema.plugin(timestamps);

var cond_reglement = {};
Dict.dict({dictName: "fk_payment_term", object: true}, function (err, docs) {
    cond_reglement = docs;
});

/**
 * Pre-save hook
 */
billSchema.pre('save', function (next) {
    var SeqModel = MODEL('Sequence').Schema;
    var EntityModel = MODEL('entity').Schema;

    this.calculate_date_lim_reglement();

    this.total_ht = 0;
    this.total_tva = [];
    this.total_ttc = 0;

    if (this.isNew)
        this.history = [];

    var i, j, length, found;
    var subtotal = 0;

    for (i = 0, length = this.lines.length; i < length; i++) {
        // SUBTOTAL
        if (this.lines[i].product.name == 'SUBTOTAL') {
            this.lines[i].total_ht = subtotal;
            subtotal = 0;
            continue;
        }

        //console.log(object.lines[i].total_ht);
        this.total_ht += this.lines[i].total_ht;
        subtotal += this.lines[i].total_ht;
        //this.total_ttc += this.lines[i].total_ttc;

        //Add VAT
        found = false;
        for (j = 0; j < this.total_tva.length; j++)
            if (this.total_tva[j].tva_tx === this.lines[i].tva_tx) {
                this.total_tva[j].total += this.lines[i].total_tva;
                found = true;
                break;
            }

        if (!found) {
            this.total_tva.push({
                tva_tx: this.lines[i].tva_tx,
                total: this.lines[i].total_tva
            });
        }

    }

    // shipping cost
    if (this.shipping.total_ht) {
        this.total_ht += this.shipping.total_ht;

        this.shipping.total_tva = this.shipping.total_ht * this.shipping.tva_tx / 100;

        //Add VAT
        found = false;
        for (j = 0; j < this.total_tva.length; j++)
            if (this.total_tva[j].tva_tx === this.shipping.tva_tx) {
                this.total_tva[j].total += this.shipping.total_tva;
                found = true;
                break;
            }

        if (!found) {
            this.total_tva.push({
                tva_tx: this.shipping.tva_tx,
                total: this.shipping.total_tva
            });
        }
    }

    if (this.discount.percent) {
        this.discount.value = MODULE('utils').round(this.total_ht * this.discount.percent / 100, 2);
        this.total_ht -= this.discount.value;

        // Remise sur les TVA
        for (j = 0; j < this.total_tva.length; j++) {
            this.total_tva[j].total -= this.total_tva[j].total * this.discount.percent / 100;
        }
    }

    this.total_ht = MODULE('utils').round(this.total_ht, 2);
    //this.total_tva = Math.round(this.total_tva * 100) / 100;
    this.total_ttc = this.total_ht;

    for (j = 0; j < this.total_tva.length; j++) {
        this.total_tva[j].total = MODULE('utils').round(this.total_tva[j].total, 2);
        this.total_ttc += this.total_tva[j].total;
    }

    var self = this;

    if (!this.ref && this.isNew) {
        SeqModel.inc("PROV", function (seq) {
            //console.log(seq);
            self.ref = "PROV" + seq;
            next();
        });
    } else {
        if (this.Status != "DRAFT" && this.total_ttc != 0 && this.ref.substr(0, 4) == "PROV") {
            EntityModel.findOne({_id: self.entity}, "cptRef", function (err, entity) {
                if (err)
                    console.log(err);

                if (entity && entity.cptRef) {
                    SeqModel.inc("FA" + entity.cptRef, self.datec, function (seq) {
                        //console.log(seq);
                        self.ref = "FA" + entity.cptRef + seq;
                        next();
                    });
                } else {
                    SeqModel.inc("FA", self.datec, function (seq) {
                        //console.log(seq);
                        self.ref = "FA" + seq;
                        next();
                    });
                }
            });
        } else {
            next();
        }
    }
});

/**
 * inc - increment bill Number
 *
 * @param {function} callback
 * @api public
 */
billSchema.methods.setNumber = function () {
    var self = this;
    if (this.ref.substr(0, 4) == "PROV")
        SeqModel.inc("FA", function (seq) {
            //console.log(seq);
            self.ref = "FA" + seq;
        });
};
/**
 * 	Renvoi une date limite de reglement de facture en fonction des
 * 	conditions de reglements de la facture et date de facturation
 *
 * 	@param      string	$cond_reglement   	Condition of payment (code or id) to use. If 0, we use current condition.
 * 	@return     date     			       	Date limite de reglement si ok, <0 si ko
 */
billSchema.methods.calculate_date_lim_reglement = function () {
    var data = cond_reglement.values[this.cond_reglement_code];

    var cdr_nbjour = data.nbjour || 0;
    var cdr_fdm = data.fdm;
    var cdr_decalage = data.decalage || 0;

    /* Definition de la date limite */

    // 1 : ajout du nombre de jours
    var datelim = new Date(this.datec);
    datelim.setDate(datelim.getDate() + cdr_nbjour);
    //console.log(cdr_nbjour);

    // 2 : application de la regle "fin de mois"
    if (cdr_fdm) {
        var mois = datelim.getMonth();
        var annee = datelim.getFullYear();

        if (mois == 12) {
            mois = 1;
            annee++;
        } else {
            mois++;
        }

        // On se deplace au debut du mois suivant, et on retire un jour
        datelim.setHours(0);
        datelim.setMonth(mois);
        //datelim.setFullYear(annee);
        datelim.setDate(0);
        //console.log(datelim);
    }

    // 3 : application du decalage
    datelim.setDate(datelim.getDate() + cdr_decalage);
    //console.log(datelim);

    this.dater = datelim;
};

var statusList = {};
Dict.dict({dictName: 'fk_bill_status', object: true}, function (err, doc) {
    if (err) {
        console.log(err);
        return;
    }
    statusList = doc;
});

billSchema.virtual('status')
        .get(function () {
            var res_status = {};

            var status = this.Status;

            if (status === 'NOT_PAID' && this.dater > new Date()) //Check if late
                status = 'VALIDATE';

            if (status && statusList.values[status] && statusList.values[status].label) {
                //console.log(this);
                res_status.id = status;
                res_status.name = i18n.t(statusList.lang + ":" + statusList.values[status].label);
                //res_status.name = statusList.values[status].label;
                res_status.css = statusList.values[status].cssClass;
            } else { // By default
                res_status.id = status;
                res_status.name = status;
                res_status.css = "";
            }
            return res_status;

        });

/*var transactionList = [];
 
 TransactionModel.aggregate([
 {$group: {
 _id: '$bill.id',
 sum: {$sum: '$credit'}
 }}
 ], function (err, doc) {
 if (err)
 return console.log(err);
 
 transactionList = doc;
 });*/

billSchema.virtual('amount').get(function () {

    var amount = {};
    var id = this._id;

    /*if (transactionList) {
     for (var i = 0; i < transactionList.length; i++) {
     if (id.equals(transactionList[i]._id)) {
     amount.rest = this.total_ttc - transactionList[i].sum;
     amount.set = transactionList[i].sum;
     return amount;
     }
     }
     }*/

    return 0;
});


exports.Schema = mongoose.model('bill', billSchema, 'Facture');
exports.name = 'bill';