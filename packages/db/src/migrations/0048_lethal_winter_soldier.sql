CREATE TABLE "exchange_rate" (
	"day" date NOT NULL,
	"currency" char(3) NOT NULL,
	"per_eur" double precision NOT NULL,
	CONSTRAINT "exchange_rate_currency_day_pk" PRIMARY KEY("currency","day")
);
